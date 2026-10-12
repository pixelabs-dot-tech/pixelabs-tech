# Jeetak Rush leaderboard API

Backend for the scooter game on https://pixelabs.tech. Deployed to Hostinger from this branch.

- `GET  index.php?a=top&n=10` best scores
- `GET  index.php?a=start` signed run token
- `POST index.php?a=submit` JSON body `{name, score, coins, rare, villages, village, time, token}`

Scores are stored as JSON outside the web root. The signing key is generated on the server.
