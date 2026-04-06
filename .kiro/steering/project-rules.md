---
inclusion: always
---

<!------------------------------------------------------------------------------------
   Add rules to this file or a short description and have Kiro refine them for you.

   Learn about inclusion modes: https://kiro.dev/docs/steering/#inclusion-modes
------------------------------------------------------------------------------------->

Prioritize existing SCSS variables and Bootstrap utility classes/components. Never use hard-coded (inline) values. If a required value is missing, define a new SCSS variable in the global variables file using the project's naming convention, then reference it. Avoid creating custom CSS if a combination of Bootstrap utilities can achieve the same result.
