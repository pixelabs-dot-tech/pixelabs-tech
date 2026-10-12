<?php
/*
 * Jeetak Rush leaderboard API (pixelabs.tech)
 *
 *   GET  ?a=top[&n=10]  -> best scores (names only; contact details are never public)
 *   GET  ?a=start       -> signed run token (issued when a run starts)
 *   GET  ?a=check&name= -> whether a name is allowed (nothing is saved)
 *   POST ?a=submit      -> body: JSON {name, contact?, score, coins, rare, villages, village, time, token}
 *   POST ?a=t           -> anonymous visit counting from pixelabs.tech (see lib.php, site analytics)
 *
 * Data lives outside the web root. Nothing secret is stored in this repository:
 * the signing key is generated on the server the first time it is needed.
 * The admin page is admin.php.
 */

declare(strict_types=1);
define('JR', 1);
require __DIR__ . '/lib.php';

header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
cors(ALLOWED_ORIGINS);

$method = isset($_SERVER['REQUEST_METHOD']) ? strtoupper((string) $_SERVER['REQUEST_METHOD']) : 'GET';
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/* ------------------------------------------------------------------ routes */
$a = isset($_GET['a']) ? (string) $_GET['a'] : 'top';

if ($method === 'GET' && $a === 'top') {
    $n = isset($_GET['n']) ? max(1, min(50, (int) $_GET['n'])) : 10;
    $board = read_json('board.json', array());
    send(200, array('ok' => true, 'top' => board_public($board, $n), 'total' => count($board)));
}

if ($method === 'POST' && $a === 't') {
    $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    $local = preg_match('~^http://(localhost|127\.0\.0\.1)(:\d{1,5})?$~', $origin) === 1;
    $ua = (string) ($_SERVER['HTTP_USER_AGENT'] ?? '');
    $robot = preg_match('/bot|crawl|spider|slurp|lighthouse|pagespeed|preview/i', $ua) === 1 || (!$local && stripos($ua, 'headless') !== false);
    if ((from_site() || $local) && !$robot) {
        $raw = (string) file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
        $in = strlen($raw) <= MAX_BODY ? json_decode($raw, true) : null;
        if (is_array($in)) {
            with_lock(function () use ($in) { analytics_record($in); });
        }
    }
    http_response_code(204);
    exit;
}

if ($method === 'GET' && $a === 'check') {
    $why = valid_name(clean_name(isset($_GET['name']) ? (string) $_GET['name'] : ''));
    send(200, array('ok' => true, 'allowed' => $why === null, 'error' => $why));
}

if ($method === 'GET' && $a === 'start') {
    $site = from_site();
    with_lock(function () use ($site) { bump_stats('starts', $site); });
    $payload = b64u((string) json_encode(array('i' => time(), 'n' => bin2hex(random_bytes(9)))));
    $sig = b64u(hash_hmac('sha256', $payload, secret(), true));
    send(200, array('ok' => true, 'token' => $payload . '.' . $sig));
}

if ($method === 'POST' && $a === 'submit') {
    $raw = (string) file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
    if (strlen($raw) > MAX_BODY) {
        send(413, array('ok' => false, 'error' => 'Too large.'));
    }
    $in = json_decode($raw, true);
    if (!is_array($in)) {
        send(400, array('ok' => false, 'error' => 'Bad request.'));
    }

    $name = clean_name(isset($in['name']) ? (string) $in['name'] : '');
    $why = valid_name($name);
    if ($why !== null) {
        send(422, array('ok' => false, 'error' => $why, 'field' => 'name'));
    }

    $contact = clean_contact(isset($in['contact']) ? (string) $in['contact'] : '');
    $whyC = valid_contact($contact);
    if ($whyC !== null) {
        send(422, array('ok' => false, 'error' => $whyC, 'field' => 'contact'));
    }

    $score = isset($in['score']) ? (int) $in['score'] : -1;
    $coins = isset($in['coins']) ? (int) $in['coins'] : 0;
    $rare = isset($in['rare']) ? (int) $in['rare'] : 0;
    $villages = isset($in['villages']) ? (int) $in['villages'] : 0;
    $time = isset($in['time']) ? (float) $in['time'] : 0.0;
    $village = clean_name(isset($in['village']) ? (string) $in['village'] : '');
    $village = mb_substr(preg_replace('/[^\p{L}\p{N} \'\-]/u', '', $village) ?? '', 0, 24, 'UTF-8');
    $token = isset($in['token']) ? (string) $in['token'] : '';

    if ($score < 0 || $score > 5000000 || $time < 3 || $time > 3600 || $coins < 0 || $rare < 0 || $villages < 0) {
        send(422, array('ok' => false, 'error' => 'That run does not add up.'));
    }

    // run token: proves the run started at least `time` seconds ago
    $parts = explode('.', $token);
    if (count($parts) !== 2 || !hash_equals(b64u(hash_hmac('sha256', $parts[0], secret(), true)), $parts[1])) {
        send(422, array('ok' => false, 'error' => 'This run could not be verified. Play again to save a score.'));
    }
    $tok = json_decode(unb64u($parts[0]), true);
    if (!is_array($tok) || !isset($tok['i'], $tok['n'])) {
        send(422, array('ok' => false, 'error' => 'This run could not be verified.'));
    }
    $age = time() - (int) $tok['i'];
    if ($age > TOKEN_TTL) {
        send(422, array('ok' => false, 'error' => 'This run is too old to save.'));
    }
    if ($age + 4 < $time) {
        send(422, array('ok' => false, 'error' => 'That run does not add up.'));
    }

    // plausibility: generous ceilings well above what the game can award
    if ($score > 260 * $time + 600 || $coins > 7 * $time + 30 || $rare > $time / 4 + 3 || $villages > $time / 8 + 2) {
        send(422, array('ok' => false, 'error' => 'That run does not add up.'));
    }

    $result = with_lock(function () use ($name, $contact, $score, $coins, $rare, $villages, $village, $tok) {
        $now = time();

        // one save per run
        $used = read_json('used.json', array());
        foreach ($used as $k => $ts) {
            if ($now - (int) $ts > TOKEN_TTL) {
                unset($used[$k]);
            }
        }
        $nonce = (string) $tok['n'];
        if (isset($used[$nonce])) {
            return array(409, array('ok' => false, 'error' => 'This run was already saved.'));
        }

        // rate limit per visitor (hashed, pruned after an hour)
        $rate = read_json('rate.json', array());
        foreach ($rate as $k => $list) {
            $rate[$k] = array_values(array_filter((array) $list, function ($ts) use ($now) {
                return $now - (int) $ts < 3600;
            }));
            if (!$rate[$k]) {
                unset($rate[$k]);
            }
        }
        $who = client_hash();
        $mine = isset($rate[$who]) ? $rate[$who] : array();
        if ($mine && $now - (int) max($mine) < MIN_GAP) {
            return array(429, array('ok' => false, 'error' => 'Slow down a little, then try again.'));
        }
        if (count($mine) >= MAX_PER_HOUR) {
            return array(429, array('ok' => false, 'error' => 'Too many saves for now. Try again later.'));
        }
        $mine[] = $now;
        $rate[$who] = $mine;
        $used[$nonce] = $now;

        $board = read_json('board.json', array());
        $key = name_key($name);
        $prev = null;
        foreach ($board as $i => $e) {
            if (isset($e['k']) && $e['k'] === $key) {
                $prev = $i;
                break;
            }
        }
        $entry = array('n' => $name, 'k' => $key, 's' => $score, 'v' => $village, 'c' => $coins, 'r' => $rare, 'd' => $villages, 't' => $now);
        $improved = true;
        $previous = null;
        if ($prev !== null) {
            $previous = (int) $board[$prev]['s'];
            $oldContact = isset($board[$prev]['p']) ? (string) $board[$prev]['p'] : '';
            if ($score > $previous) {
                $board[$prev] = $entry;
            } else {
                $improved = false;
            }
            // keep the newest contact they gave, even when this run wasn't their best
            $board[$prev]['p'] = $contact !== '' ? $contact : $oldContact;
            if ($board[$prev]['p'] === '') {
                unset($board[$prev]['p']);
            }
        } else {
            if ($contact !== '') {
                $entry['p'] = $contact;
            }
            $board[] = $entry;
        }
        sort_board($board);
        $board = array_slice($board, 0, MAX_KEEP);

        // rank of this score among everyone else's best
        $rank = 1;
        foreach ($board as $e) {
            if ($e['k'] !== $key && (int) $e['s'] > $score) {
                $rank++;
            }
        }
        $kept = false;
        foreach ($board as $e) {
            if ($e['k'] === $key) {
                $kept = true;
                break;
            }
        }

        write_json('board.json', $board);
        write_json('used.json', $used);
        write_json('rate.json', $rate);
        bump_stats('saves', false);
        analytics_record(array('e' => 'saved'));

        return array(200, array(
            'ok' => true,
            'rank' => $rank,
            'onBoard' => $kept,
            'improved' => $improved,
            'previous' => $previous,
            'top' => board_public($board, 10),
            'total' => count($board),
        ));
    });
    send($result[0], $result[1]);
}

send(404, array('ok' => false, 'error' => 'Not found.'));
