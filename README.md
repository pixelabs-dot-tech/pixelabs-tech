# Jeetak Rush leaderboard API

Backend for the scooter game on https://pixelabs.tech. Deployed to Hostinger from this branch.

- `GET  index.php?a=top&n=10` best scores (names only)
- `GET  index.php?a=start` signed run token
- `GET  index.php?a=check&name=` whether a name is allowed
- `POST index.php?a=submit` JSON body `{name, contact?, score, coins, rare, villages, village, time, token}`
- `admin.php` everyone who saved a score, private contacts, delete or block names, CSV export (password protected)

Scores are stored as JSON outside the web root. The signing key is generated on the server.
Rude-name lists are in `names.json` and shared with the game page.
