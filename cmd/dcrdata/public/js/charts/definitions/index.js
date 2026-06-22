// Side-effect barrel: importing this registers every chart definition + the
// coin-supply/fees factories. The shell imports it once on connect.
import { registerCoinFactories } from '../registry'
import { coinSupplyDef } from './coin_supply' // also registers coin-supply/0
import { feesDef } from './fees' // also registers fees (VAR)
import './ticket_price'
import './ticket_pool'
import './stake_participation'
import './sizes'
import './pow_difficulty'
import './privacy_participation'
import './duration_chainwork'
import './hashrate'
import './missed_votes'

registerCoinFactories(coinSupplyDef, feesDef)
