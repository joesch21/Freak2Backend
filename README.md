# Freaks2 Backend

This repository provides a clean implementation of the Freaky Friday game backend for the **Freaks2** contract.  It exposes a simple HTTP API around the on‑chain [`FreakyFridayAuto`](./contracts/FreakyFridayAuto.sol) contract and includes scripts for round expiry and automatic mode switching.

## Features

- **Relayer‑assisted entry** – Participants approve the contract and the relayer calls `relayedEnter(user)` so they pay no BNB for gas.
- **Round status endpoint** – Exposes `isRoundActive`, `currentRound`, `roundStart`, `duration`, `entryAmount`, `roundMode`, `participants` and more.
- **Round closure** – Anyone can trigger `checkTimeExpired()` once the duration elapses; an optional tip from surplus GCC rewards callers.
- **Batch refunds** – The relayer can refund many participants in one transaction after a Standard round via `batchClaimRefunds()`.
- **Automatic mode scheduler** – A standalone script flips the contract’s `roundMode` to *Jackpot* on Fridays (Australia/Sydney) and back to *Standard* on other days.

## Environment

Copy `.env.example` to `.env` and fill in the following variables:

```
RPC_URL=                  # RPC endpoint for BSC network
PRIVATE_KEY=              # Private key for the relayer/admin wallet
FREAKY_ADDRESS=           # Deployed FreakyFridayAuto contract address
GCC_ADDRESS=              # GCC token address
FRONTEND_URL=             # Allowed CORS origin for your front‑end (optional)
TIMEZONE=Australia/Sydney # Timezone used by the mode scheduler
CLOSE_TIP=0.1             # Optional tip (in GCC) paid from surplus on round close
CHECK_INTERVAL_SEC=30     # How often the bot checks for round expiry
MIN_GAS_BNB=0.005         # Warn if relayer BNB falls below this amount
```

Install dependencies:

```sh
npm install
```

Run the API server:

```sh
npm start
```

Run the round expiry bot once (use cron to automate):

```sh
npm run bot
```

Run the mode scheduler (long‑running process):

```sh
npm run scheduler
```

## HTTP API

All endpoints are relative to the root of the server (e.g. `http://localhost:3000/status`).

### `GET /status`

Returns the current game state:

```json
{
  "roundActive": true,
  "currentRound": "12",
  "roundStart": "1724209205",
  "duration": "86400",
  "entryAmount": "50000000000000000000",
  "roundMode": 0,
  "maxPlayers": "500",
  "participantCount": 3,
  "participants": ["0x123…", "0x456…", "0x789…"]
}
```

### `POST /relay-entry`

Registers a user for the current round.  Body:

```json
{ "user": "0xABCDEF…" }
```

Requires that the user has previously approved the contract for at least `entryAmount` GCC.  The relayer pays gas.  Responds with the transaction hash on success.

### `POST /check-expired`

Attempts to close the current round.  Only succeeds if the round is active and `now >= roundStart + duration`.  Emits the `RoundCompleted` event and distributes the prize/refund entitlements.  Returns the transaction hash on success.

### `POST /batch-refund`

Used after a Standard round has closed to refund multiple users.  Body:

```json
{
  "round": 12,
  "users": ["0xAAA…", "0xBBB…", "0xCCC…"],
  "maxCount": 3
}
```

The relayer calls `batchClaimRefunds(round, users, maxCount)` and refunds up to `maxCount` eligible participants.  If you omit `maxCount`, all users in the list will be processed.

## Notes

- Individual participants must call `claimRefund(round)` from their own wallet to claim refunds if the relayer does not batch refund them.  The backend does not expose a `claimRefund` endpoint because it cannot impersonate users.
- `setRelayer`, `setMaxPlayers`, `setCloseTip`, `fundBonus`, `withdrawBNB`, and `withdrawLeftovers` are admin‑only contract calls and are not exposed via HTTP.  You can call them from a script using the same signer.
- The ABI included in `public/freakyFridayGameAbi.json` is a minimal subset covering the functions used by the backend and front‑end.  If you need additional getters, regenerate the ABI from your Solidity source using `solc`.

## License

MIT