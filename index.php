<?php
/*
 * Jeetak Rush leaderboard API (pixelabs.tech)
 *
 *   GET  ?a=top[&n=10]  -> best scores
 *   GET  ?a=start       -> signed run token (issued when a run starts)
 *   POST ?a=submit      -> body: JSON {name, score, coins, rare, villages, village, time, token}
 *
 * Data lives outside the web root. Nothing secret is stored in this repository:
 * the signing key is generated on the server the first time it is needed.
 */

declare(strict_types=1);

const MAX_KEEP = 300;        // entries kept on the board (best score per name)
const MAX_BODY = 4096;       // bytes
const TOKEN_TTL = 7200;      // seconds a run token stays valid
const MIN_GAP = 6;           // seconds between two submissions from one visitor
const MAX_PER_HOUR = 60;     // submissions per visitor per hour

$ALLOWED_ORIGINS = array(
    'https://pixelabs.tech',
    'https://www.pixelabs.tech',
);

/* ------------------------------------------------------------------ output */
function send(int $code, array $body): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function cors(array $allowed): void
{
    $origin = isset($_SERVER['HTTP_ORIGIN']) ? (string) $_SERVER['HTTP_ORIGIN'] : '';
    $ok = in_array($origin, $allowed, true)
        || preg_match('~^http://(localhost|127\.0\.0\.1)(:\d{1,5})?$~', $origin) === 1;
    if ($ok) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
        header('Access-Control-Max-Age: 86400');
    }
}

header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
cors($ALLOWED_ORIGINS);

$method = isset($_SERVER['REQUEST_METHOD']) ? strtoupper((string) $_SERVER['REQUEST_METHOD']) : 'GET';
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/* ------------------------------------------------------------------ storage */
function data_dir(): string
{
    static $dir = null;
    if ($dir !== null) {
        return $dir;
    }
    // keep data above the web root: /home/<user>/domains/<site>/jeetak-rush-data
    $pos = strpos(__DIR__, '/public_html');
    $root = $pos !== false ? substr(__DIR__, 0, $pos) : dirname(__DIR__);
    $candidates = array($root . '/jeetak-rush-data', __DIR__ . '/data');
    foreach ($candidates as $c) {
        if (!is_dir($c)) {
            @mkdir($c, 0700, true);
        }
        if (is_dir($c) && is_writable($c)) {
            if ($c === __DIR__ . '/data' && !is_file($c . '/.htaccess')) {
                @file_put_contents($c . '/.htaccess', "Require all denied\n");
            }
            $dir = $c;
            return $dir;
        }
    }
    send(500, array('ok' => false, 'error' => 'storage'));
    return '';
}

function read_json(string $file, $fallback)
{
    $path = data_dir() . '/' . $file;
    if (!is_file($path)) {
        return $fallback;
    }
    $raw = @file_get_contents($path);
    if ($raw === false || $raw === '') {
        return $fallback;
    }
    $v = json_decode($raw, true);
    return is_array($v) ? $v : $fallback;
}

function write_json(string $file, $value): void
{
    $path = data_dir() . '/' . $file;
    $tmp = $path . '.' . bin2hex(random_bytes(4)) . '.tmp';
    file_put_contents($tmp, json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    rename($tmp, $path);
}

function with_lock(callable $fn)
{
    $fh = fopen(data_dir() . '/.lock', 'c');
    if ($fh === false) {
        send(500, array('ok' => false, 'error' => 'lock'));
    }
    flock($fh, LOCK_EX);
    try {
        return $fn();
    } finally {
        flock($fh, LOCK_UN);
        fclose($fh);
    }
}

function secret(): string
{
    $path = data_dir() . '/secret.key';
    if (is_file($path)) {
        $k = (string) file_get_contents($path);
        if (strlen($k) >= 32) {
            return $k;
        }
    }
    $k = bin2hex(random_bytes(32));
    file_put_contents($path, $k, LOCK_EX);
    @chmod($path, 0600);
    return $k;
}

function b64u(string $s): string
{
    return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
}

function unb64u(string $s): string
{
    $r = base64_decode(strtr($s, '-_', '+/'), true);
    return $r === false ? '' : $r;
}

/* ------------------------------------------------------------------ names */
function clean_name(string $raw): string
{
    $s = preg_replace('/[\x{0000}-\x{001F}\x{007F}-\x{009F}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FEFF}]/u', '', $raw);
    if ($s === null) {
        return '';
    }
    $s = preg_replace('/\s+/u', ' ', $s);
    return trim((string) $s);
}

function name_key(string $name): string
{
    $s = mb_strtolower($name, 'UTF-8');
    $s = preg_replace('/[\x{064B}-\x{0652}\x{0640}]/u', '', $s);           // harakat, tatweel
    $s = strtr($s, array('أ' => 'ا', 'إ' => 'ا', 'آ' => 'ا', 'ة' => 'ه', 'ى' => 'ي'));
    return (string) preg_replace('/[^\p{L}\p{N}]+/u', '', (string) $s);
}

function is_rude(string $name): bool
{
    $lower = mb_strtolower($name, 'UTF-8');
    $lower = (string) preg_replace('/[\x{064B}-\x{0652}\x{0640}]/u', '', $lower);
    $lower = strtr($lower, array('أ' => 'ا', 'إ' => 'ا', 'آ' => 'ا', 'ة' => 'ه', 'ى' => 'ي'));
    $leet = strtr($lower, array('0' => 'o', '1' => 'i', '3' => 'e', '4' => 'a', '5' => 's', '7' => 't', '@' => 'a', '$' => 's', '!' => 'i', '|' => 'i'));
    $squash = function (string $s): string {
        return (string) preg_replace('/[^\p{L}\p{N}]+/u', '', $s);
    };

    // Anywhere in the name, even glued to other letters.
    $strong = array(
        'fuck', 'fck', 'phuck', 'shit', 'cunt', 'nigg', 'fagg', 'faggot', 'bitch', 'biatch', 'whore',
        'slut', 'pussy', 'asshole', 'arsehole', 'motherf', 'porn', 'penis', 'vagina', 'hitler', 'nazi', 'rapist',
        'sharmou', 'sharmut', 'charmou', 'sharmoot', 'manyak', 'manyok', 'manyouk', 'mnayak', 'mnayek', 'kessekh', 'kesemm',
        'كسخت', 'كسام', 'شرموط', 'منيوك', 'منيك', 'عرص', 'متناك', 'قحبه',
    );
    foreach (array($squash($lower), $squash($leet)) as $hay) {
        foreach ($strong as $w) {
            if ($w !== '' && mb_strpos($hay, $w, 0, 'UTF-8') !== false) {
                return true;
            }
        }
    }

    // Only as whole words (they appear inside ordinary names and places).
    $words = array(
        'ass', 'dick', 'cock', 'rape', 'anal', 'cum', 'sex', 'kkk', 'tits', 'twat', 'wank', 'jerk off',
        'ayre', 'ayri', 'ayr', 'air ekhtak', 'kos', 'kuss', 'kess', 'kes', 'tiz', 'teez', 'zeb', 'zebb', 'zib', 'khara', 'khra',
        'neek', '3ars', '3ers', 'ars', 'kahbe', 'ahbe', '2ahbe',
        'كس', 'زب', 'زبي', 'طيز', 'خرا', 'نيك', 'ايري', 'اير',
    );
    $tokens = array();
    foreach (array($lower, $leet) as $s) {
        $parts = preg_split('/[^\p{L}\p{N}]+/u', $s, -1, PREG_SPLIT_NO_EMPTY);
        if (is_array($parts)) {
            $tokens = array_merge($tokens, $parts);
        }
    }
    $joined = ' ' . implode(' ', $tokens) . ' ';
    foreach ($words as $w) {
        if (mb_strpos($joined, ' ' . $w . ' ', 0, 'UTF-8') !== false) {
            return true;
        }
    }
    // the Arabizi digits stay digits in the raw form
    foreach (preg_split('/[^\p{L}\p{N}]+/u', $lower, -1, PREG_SPLIT_NO_EMPTY) ?: array() as $t) {
        if (in_array($t, array('3ars', '3ers', '2ahbe', '2a7be', 'a7be', 'ka7be', 'n1k'), true)) {
            return true;
        }
    }
    return false;
}

function valid_name(string $name): ?string
{
    $len = mb_strlen($name, 'UTF-8');
    if ($len < 2) {
        return 'Use at least 2 characters.';
    }
    if ($len > 16) {
        return 'Use 16 characters or fewer.';
    }
    if (preg_match('/^[\p{L}\p{M}\p{N} ._\'\-]+$/u', $name) !== 1) {
        return 'Use letters, numbers and spaces only.';
    }
    if (name_key($name) === '') {
        return 'Use letters or numbers.';
    }
    if (preg_match('~(https?|www\.|\.com|\.net|\.org|\.lb\b)~i', $name) === 1) {
        return 'Links are not allowed in names.';
    }
    if (is_rude($name)) {
        return 'Please pick a different name.';
    }
    return null;
}

/* ------------------------------------------------------------------ board */
function board_public(array $board, int $n): array
{
    $out = array();
    foreach (array_slice($board, 0, $n) as $e) {
        $out[] = array('n' => $e['n'], 's' => $e['s'], 'v' => $e['v'], 'c' => $e['c'], 'r' => $e['r'], 'd' => $e['d'], 't' => $e['t']);
    }
    return $out;
}

function sort_board(array &$board): void
{
    usort($board, function ($a, $b) {
        if ($a['s'] !== $b['s']) {
            return $b['s'] <=> $a['s'];
        }
        return $a['t'] <=> $b['t'];
    });
}

function client_hash(): string
{
    $ip = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '0';
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {   // behind the host's CDN
        $ip = trim(explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
    }
    $ua = isset($_SERVER['HTTP_USER_AGENT']) ? substr((string) $_SERVER['HTTP_USER_AGENT'], 0, 160) : '';
    return substr(hash_hmac('sha256', $ip . '|' . $ua, secret()), 0, 24);
}

/* ------------------------------------------------------------------ routes */
$a = isset($_GET['a']) ? (string) $_GET['a'] : 'top';

if ($method === 'GET' && $a === 'top') {
    $n = isset($_GET['n']) ? max(1, min(50, (int) $_GET['n'])) : 10;
    $board = read_json('board.json', array());
    send(200, array('ok' => true, 'top' => board_public($board, $n), 'total' => count($board)));
}

if ($method === 'GET' && $a === 'start') {
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

    $result = with_lock(function () use ($name, $score, $coins, $rare, $villages, $village, $tok) {
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
            if ($score > $previous) {
                $board[$prev] = $entry;
            } else {
                $improved = false;
            }
        } else {
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
