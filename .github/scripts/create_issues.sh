#!/usr/local/bin/bash

#############################################################################
# GitHub Issues Batch Creator
# Optimized for Bash 5+ (Homebrew) and GitHub CLI
#
# Read GITHUB_ISSUES_AND_PROJECT_BOARD.md for full instructions and tasks.json schema rules.
#
#############################################################################

set -e

#############################################################################
# Configuration (overridable via environment variables)
#############################################################################
REPO="${REPO:-monetarium/monetarium-explorer}"
MILESTONE="${MILESTONE:-v1}"
TASKS_FILE="tasks.json"
DRY_RUN=false
RESUME_ONLY=false
AUTO_CONFIRM=false
STATE_FILE=".create_issues_state.json"
LOG_FILE="create_issues.log"
if [[ -t 1 ]]; then
    exec > >(tee -a "$LOG_FILE") 2>&1
else
    exec >> "$LOG_FILE" 2>&1
fi

#############################################################################
# Helper: Rate-limit aware GitHub CLI wrapper
#############################################################################
gh_retry() {
    local attempt=1
    local max=5
    local output

    while (( attempt <= max )); do
        if output=$(command gh "$@" 2>&1); then
            echo "$output"
            return 0
        fi

        if echo "$output" | grep -iq "rate limit"; then
            echo "  [Rate limit detected] Waiting $((attempt * 5))s..." >&2
            sleep $((attempt * 5))
            ((attempt++))
        else
            echo "$output"
            return 1
        fi
    done
    return 1
}
#############################################################################
# Parse CLI arguments
#############################################################################
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --resume)
            RESUME_ONLY=true
            shift
            ;;
        -y|--yes)
            AUTO_CONFIRM=true
            shift
            ;;
        --file)
            TASKS_FILE="$2"
            shift 2
            ;;
        *)
            echo "Unknown argument: $1"
            echo "Usage: $0 [--dry-run] [--resume] [-y|--yes] [--file <tasks_file.json>]"
            exit 1
            ;;
    esac
done

#############################################################################
# Check dependencies
#############################################################################
if ! command -v jq &> /dev/null; then
    echo "Error: jq is not installed. Run: brew install jq"
    exit 1
fi

if ! command -v gh &> /dev/null; then
    echo "Error: gh is not installed. Run: brew install gh && gh auth login"
    exit 1
fi

if [[ ! -f "$TASKS_FILE" ]]; then
    echo "Error: Tasks file '$TASKS_FILE' not found!"
    exit 1
fi

#############################################################################
# Validate tasks.json structure
#############################################################################
echo "--- Validating $TASKS_FILE ---"

task_count=$(jq '.tasks | length' "$TASKS_FILE")

if [[ "$task_count" -eq 0 ]]; then
    echo "Error: No tasks found in $TASKS_FILE."
    exit 1
fi

validation_errors=0

duplicates=$(jq -r '.tasks[].title' "$TASKS_FILE" | sort | uniq -d)
if [[ -n "$duplicates" ]]; then
    echo "  [!] Duplicate titles found (titles must be unique for state tracking):"
    echo "$duplicates" | while read -r line; do echo "      - $line"; done
    (( validation_errors++ )) || true
fi

for (( i=0; i<task_count; i++ )); do
    type=$(jq -r ".tasks[$i].type" "$TASKS_FILE")
    title=$(jq -r ".tasks[$i].title" "$TASKS_FILE")

    # Validate type
    if [[ "$type" != "parent" && "$type" != "sub-issue" && "$type" != "issue" ]]; then
        echo "  [!] tasks[$i]: Invalid type '$type'. Must be 'parent', 'sub-issue', or 'issue'."
        (( validation_errors++ )) || true
    fi

    # Validate title
    if [[ -z "$title" || "$title" == "null" ]]; then
        echo "  [!] tasks[$i]: Missing or null 'title'."
        (( validation_errors++ )) || true
    fi

    # Validate parent index for sub-issues
    if [[ "$type" == "sub-issue" ]]; then
        parent_idx=$(jq -r ".tasks[$i].parent" "$TASKS_FILE")

        if [[ -z "$parent_idx" || "$parent_idx" == "null" ]]; then
            echo "  [!] tasks[$i] ('$title'): sub-issue is missing 'parent' index."
            (( validation_errors++ )) || true
        elif [[ "$parent_idx" -ge "$task_count" ]]; then
            echo "  [!] tasks[$i] ('$title'): 'parent' index $parent_idx is out of bounds (max: $((task_count - 1)))."
            (( validation_errors++ )) || true
        else
            parent_type=$(jq -r ".tasks[$parent_idx].type" "$TASKS_FILE")
            if [[ "$parent_type" != "parent" ]]; then
                echo "  [!] tasks[$i] ('$title'): 'parent' index $parent_idx does not point to a 'parent' type task."
                (( validation_errors++ )) || true
            fi
            if [[ "$parent_idx" -ge "$i" ]]; then
                echo "  [!] tasks[$i] ('$title'): 'parent' index $parent_idx must appear BEFORE the sub-issue in the array."
                (( validation_errors++ )) || true
            fi
        fi
    fi
done

if [[ "$validation_errors" -gt 0 ]]; then
    echo ""
    echo "Validation failed with $validation_errors error(s). Fix $TASKS_FILE and re-run."
    exit 1
fi

echo "  ✅ Validation passed ($task_count tasks found)."
echo ""

#############################################################################
# Dry-run notice
#############################################################################
if $DRY_RUN; then
    echo "⚠️  DRY-RUN MODE: No issues will be created. Showing plan:"
    echo ""
    for (( i=0; i<task_count; i++ )); do
        type=$(jq -r ".tasks[$i].type" "$TASKS_FILE")
        title=$(jq -r ".tasks[$i].title" "$TASKS_FILE")
        assignee=$(jq -r ".tasks[$i].assignee // \"(unassigned)\"" "$TASKS_FILE")
        labels=$(jq -r '(.tasks['"$i"'].labels // ["enhancement"]) | join(", ")' "$TASKS_FILE")
        if [[ "$type" == "parent" ]]; then
            issue_type=$(jq -r ".tasks[$i].issue_type // \"Feature\"" "$TASKS_FILE")
            echo "  [PARENT]    $title | type: $issue_type | assignee: $assignee | labels: $labels"
        elif [[ "$type" == "sub-issue" ]]; then
            issue_type=$(jq -r ".tasks[$i].issue_type // \"Task\"" "$TASKS_FILE")
            parent_idx=$(jq -r ".tasks[$i].parent" "$TASKS_FILE")
            parent_title=$(jq -r ".tasks[$parent_idx].title" "$TASKS_FILE")
            echo "  [SUB-ISSUE] $title | type: $issue_type | assignee: $assignee | labels: $labels | parent: [$parent_title]"
        else
            issue_type=$(jq -r ".tasks[$i].issue_type // \"Task\"" "$TASKS_FILE")
            echo "  [ISSUE]     $title | type: $issue_type | assignee: $assignee | labels: $labels"
        fi
    done
    echo ""
    echo "Dry-run complete. Re-run without --dry-run to create issues."
    exit 0
fi

#############################################################################
# Confirmation guard & State Initialization
#############################################################################
if [[ "$AUTO_CONFIRM" == false ]]; then
    echo "⚠️  You are about to create live issues in production repo: $REPO"
    read -p "Type 'yes' to continue: " confirm
    if [[ "$confirm" != "yes" ]]; then
        echo "Aborted."
        exit 1
    fi
fi

if [[ "$RESUME_ONLY" == true ]]; then
    if [[ ! -f "$STATE_FILE" ]]; then
        echo "Error: No state file found to resume from."
        exit 1
    fi
    echo "Resuming from existing state file ($STATE_FILE) — already-created issues will be skipped."
else
    # Explicitly clear old partial states if not resuming
    rm -f "$STATE_FILE"
    echo "{}" > "$STATE_FILE"
    echo "Starting fresh (no --resume flag provided)."
fi
echo ""

# Associative array: JSON index -> GitHub issue number
declare -A ISSUE_MAP

# Load previously created issues from state safely (handles spaces in titles)
while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    num=$(jq -r --arg k "$key" '.[$k]' "$STATE_FILE")
    ISSUE_MAP["$key"]=$num
done < <(jq -r 'keys[]?' "$STATE_FILE" 2>/dev/null || true)

#############################################################################
# Fetch Org Issue Types Mapping
# Issue types require their numeric database ID for the PATCH API.
# This queries the org once to map names to IDs.
#############################################################################
declare -A ISSUE_TYPES
ORG_NAME=$(echo "$REPO" | cut -d'/' -f1)
echo "--- Fetching Org Issue Types ($ORG_NAME) ---"
if types_raw=$(gh_retry api "/orgs/$ORG_NAME/issue-types" 2>/dev/null); then
    # jq parses the array of objects into lines of "Name|NodeID"
    while IFS="|" read -r t_name t_node_id; do
        ISSUE_TYPES["$t_name"]="$t_node_id"
    done <<< "$(echo "$types_raw" | jq -r '.[]? | "\(.name)|\(.node_id)"')"
    echo "  Loaded ${#ISSUE_TYPES[@]} issue types: ${!ISSUE_TYPES[*]}"
else
    echo "  (No issue types found for org '$ORG_NAME' or token lacks permission. Continuing without types...)"
fi
echo ""

#############################################################################
# Helper: build --label flags from a JSON array or default
#############################################################################
build_label_flags() {
    local idx=$1
    local raw_labels
    raw_labels=$(jq -r ".tasks[$idx].labels // [\"enhancement\"] | .[]" "$TASKS_FILE")
    local flags=""
    while IFS= read -r label; do
        flags="$flags --label \"$label\""
    done <<< "$raw_labels"
    echo "$flags"
}

#############################################################################
# Helper: set GitHub issue type (Feature / Task / Bug) via REST API
# Requires the org to have issue types configured in GitHub settings.
# Fails gracefully — a type error will NOT abort the script.
#############################################################################
set_issue_type() {
    local issue_node_id="$1"
    local type_name="$2"
    local type_node_id="${ISSUE_TYPES[$type_name]:-""}"

    if [[ -z "$type_node_id" ]]; then
        echo -n "(type '$type_name' not found in org settings) "
        return
    fi
    if [[ -z "$issue_node_id" ]]; then
        echo -n "(type not set - missing issue node id) "
        return
    fi

    # Issue types MUST be set via GraphQL (REST API PATCH ignores it silently)
    if gh_retry api graphql -f query="
        mutation {
            updateIssue(input: {
                id: \"$issue_node_id\",
                issueTypeId: \"$type_node_id\"
            }) {
                issue { number }
            }
        }" &>/dev/null; then
        echo -n "(type: $type_name) "
    else
        echo -n "(type not set) "
    fi
}

#############################################################################
# Stats counters
#############################################################################
parents_created=0
parents_skipped=0
subissues_created=0
subissues_skipped=0
declare -a created_parent_nums=()

#############################################################################
# Step 1: Create PARENT issues
#############################################################################
echo "--- Step 1: Creating Parent Issues ---"

errors=0

for (( i=0; i<task_count; i++ )); do
    type=$(jq -r ".tasks[$i].type" "$TASKS_FILE")
    [[ "$type" != "parent" ]] && continue

    title=$(jq -r ".tasks[$i].title" "$TASKS_FILE")

    # Idempotency check
    if [[ -n "${ISSUE_MAP["$title"]+_}" ]]; then
        echo "  ⏭️  Skipping parent tasks[$i] — already created as #${ISSUE_MAP["$title"]}"
        (( parents_skipped++ )) || true
        continue
    fi
    description=$(jq -r ".tasks[$i].description // \"\"" "$TASKS_FILE")
    assignee=$(jq -r ".tasks[$i].assignee // empty" "$TASKS_FILE")

    # Build label flags
    label_flags=()
    while IFS= read -r label; do
        label_flags+=("--label" "$label")
    done < <(jq -r ".tasks[$i].labels // [\"enhancement\"] | .[]" "$TASKS_FILE")

    # Build assignee flag
    assignee_flags=()
    [[ -n "$assignee" ]] && assignee_flags=("--assignee" "$assignee")

    issue_type=$(jq -r ".tasks[$i].issue_type // \"Feature\"" "$TASKS_FILE")
    echo -n "  Creating: [$title]... "

    if ! url=$(gh_retry issue create \
        --repo "$REPO" \
        --title "$title" \
        --body "$description" \
        --milestone "$MILESTONE" \
        "${label_flags[@]}" \
        "${assignee_flags[@]+"${assignee_flags[@]}"}"); then
        
        # Format API error neatly
        clean_err=$(echo "$url" | tail -n 1 | sed 's/^ //')
        echo "❌ (creation failed: $clean_err)"
        
        (( errors++ )) || true
        sleep 2
        continue
    fi

    num=$(echo "$url" | grep -oE '[0-9]+$')
    ISSUE_MAP["$title"]=$num

    # Get the GraphQL node ID so we can set the issue type
    issue_node_id=$(gh_retry api "/repos/$REPO/issues/$num" --jq '.node_id' 2>/dev/null || echo "")

    # Persist to state file using title as key
    tmp=$(jq --arg t "$title" --arg n "$num" '.[$t] = ($n|tonumber)' "$STATE_FILE")
    echo "$tmp" > "$STATE_FILE"

    # Set GitHub issue type via GraphQL
    set_issue_type "$issue_node_id" "$issue_type"

    (( parents_created++ )) || true
    created_parent_nums+=("#$num")
    echo "✅ #$num"

    sleep 0.5  # Rate limiting
done

echo ""

#############################################################################
# Step 2: Create SUB-ISSUES and link natively to parents
#############################################################################
echo "--- Step 2: Creating Sub-Issues & Standalone Issues ---"

for (( i=0; i<task_count; i++ )); do
    type=$(jq -r ".tasks[$i].type" "$TASKS_FILE")
    [[ "$type" != "sub-issue" && "$type" != "issue" ]] && continue
    title=$(jq -r ".tasks[$i].title" "$TASKS_FILE")

    # Idempotency check
    if [[ -n "${ISSUE_MAP["$title"]+_}" ]]; then
        echo "  ⏭️  Skipping tasks[$i] — already created as #${ISSUE_MAP["$title"]}"
        (( subissues_skipped++ )) || true
        continue
    fi

    description=$(jq -r ".tasks[$i].description // \"\"" "$TASKS_FILE")
    assignee=$(jq -r ".tasks[$i].assignee // empty" "$TASKS_FILE")
    
    if [[ "$type" == "sub-issue" ]]; then
        parent_idx=$(jq -r ".tasks[$i].parent" "$TASKS_FILE")
        parent_title=$(jq -r ".tasks[$parent_idx].title" "$TASKS_FILE")
        parent_num=${ISSUE_MAP["$parent_title"]:-""}

        # Append "Part of #N" to body only if native linking not available as fallback
        if [[ -n "$parent_num" ]]; then
            full_body="${description}"$'\n\n'"Part of #$parent_num"
        else
            full_body="$description"
        fi
        echo -n "  Creating: [$title] (child of #${parent_num:-"?"})... "
    else
        parent_num=""
        full_body="$description"
        echo -n "  Creating: [$title]... "
    fi

    # Build label flags
    label_flags=()
    while IFS= read -r label; do
        label_flags+=("--label" "$label")
    done < <(jq -r ".tasks[$i].labels // [\"enhancement\"] | .[]" "$TASKS_FILE")

    # Build assignee flag
    assignee_flags=()
    [[ -n "$assignee" ]] && assignee_flags=("--assignee" "$assignee")

    issue_type=$(jq -r ".tasks[$i].issue_type // \"Task\"" "$TASKS_FILE")

    if ! child_url=$(gh_retry issue create \
        --repo "$REPO" \
        --title "$title" \
        --body "$full_body" \
        --milestone "$MILESTONE" \
        "${label_flags[@]}" \
        "${assignee_flags[@]+"${assignee_flags[@]}"}"); then
        
        clean_err=$(echo "$child_url" | tail -n 1 | sed 's/^ //')
        echo "❌ (creation failed: $clean_err)"
        
        (( errors++ )) || true
        sleep 2
        continue
    fi

    child_num=$(echo "$child_url" | grep -oE '[0-9]+$')
    ISSUE_MAP["$title"]=$child_num

    # Fetch IDs necessary for setting type and linking sub-issues
    child_resp=$(gh_retry api "/repos/$REPO/issues/$child_num" --jq '{db_id: .id, node_id: .node_id}' 2>/dev/null || echo "{}")
    child_db_id=$(echo "$child_resp" | jq -r '.db_id // empty')
    child_node_id=$(echo "$child_resp" | jq -r '.node_id // empty')

    # Persist to state file using title key
    tmp=$(jq --arg t "$title" --arg n "$child_num" '.[$t] = ($n|tonumber)' "$STATE_FILE")
    echo "$tmp" > "$STATE_FILE"

    # Set GitHub issue type via GraphQL
    set_issue_type "$child_node_id" "$issue_type"

    # Native sub-issue linking via GitHub API
    if [[ "$type" == "sub-issue" && -n "$parent_num" ]]; then
        # The sub_issues endpoint requires the database ID (not the issue #number)
        if [[ -n "$child_db_id" ]]; then
            linked=false
            # GitHub internal indexing can delay sub-issue DB presence
            for attempt in {1..3}; do
                if gh_retry api --method POST "/repos/$REPO/issues/$parent_num/sub_issues" \
                    --field sub_issue_id="$child_db_id" &>/dev/null; then
                    echo -n "(linked natively) "
                    linked=true
                    break
                else
                    sleep 1
                fi
            done
            if ! $linked; then
                echo -n "(link failed) "
                (( errors++ )) || true
            fi
        else
            echo -n "(could not fetch db id) "
            (( errors++ )) || true
        fi
    fi

    (( subissues_created++ )) || true
    echo "✅ #$child_num"
done



#############################################################################
# Summary
#############################################################################
echo ""
echo "════════════════════════════════════════════════"
echo "  ✅ Done! Summary for [$REPO] @ milestone [$MILESTONE]"
echo "────────────────────────────────────────────────"
echo "  Parent issues created : $parents_created  (skipped: $parents_skipped)"
echo "  Sub-issues created    : $subissues_created  (skipped: $subissues_skipped)"
if [[ ${#created_parent_nums[@]} -gt 0 ]]; then
    echo "  New parent issue #s   : ${created_parent_nums[*]}"
fi
echo "════════════════════════════════════════════════"

# Clean up state optionally on success
if [[ "$errors" -eq 0 ]]; then
    rm -f "$STATE_FILE"
    echo "  State file cleaned up."
    echo ""
    exit 0
else
    echo "  ⚠️ Finished with $errors error(s). State file preserved so you can safely retry."
    echo ""
    exit 1
fi
