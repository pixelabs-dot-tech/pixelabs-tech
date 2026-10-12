<?php
/* Shared code for the Jeetak Rush leaderboard: storage, names, board. */
declare(strict_types=1);

if (!defined('JR')) {
    http_response_code(404);
    exit;
}

const MAX_KEEP = 2000;       // entries kept on the board (best score per name)
const MAX_BODY = 4096;       // bytes
const TOKEN_TTL = 7200;      // seconds a run token stays valid
const MIN_GAP = 6;           // seconds between two submissions from one visitor
const MAX_PER_HOUR = 60;     // submissions per visitor per hour

const ALLOWED_ORIGINS = array(
    'https://pixelabs.tech',
    'https://www.pixelabs.tech',
);
const TZ = 'Asia/Beirut';

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

/* Names are folded before checking: lower case, accents removed, Arabic letters
   unified (أ إ آ -> ا, ة -> ه, ى -> ي) and harakat dropped. Each list is checked
   against the name as typed, with repeated letters collapsed ("ayyyre"), with
   spaces removed ("a y r e"), with trailing numbers dropped ("ayre123") and with
   numbers read as letters ("4yre"). The lists are in names.json, which the game
   page also uses, so both sides refuse the same names. */
function name_lists(): ?array
{
    static $L = false;
    if ($L !== false) {
        return $L;
    }
    $j = json_decode((string) @file_get_contents(__DIR__ . '/names.json'), true);
    if (!is_array($j) || !isset($j['anywhere'], $j['starts'], $j['words'])) {
        $L = null;
        return $L;
    }
    $single = function ($w) { return name_dedup((string) $w) === (string) $w; };   // still valid once repeats collapse
    $L = array(
        'any' => $j['anywhere'], 'anyD' => array_values(array_filter($j['anywhere'], $single)),
        'start' => $j['starts'], 'startD' => array_values(array_filter($j['starts'], $single)),
        'word' => array_flip($j['words']), 'wordD' => array_flip(array_values(array_filter($j['words'], $single))),
    );
    return $L;
}

function name_fold(string $s): string
{
    if (class_exists('Normalizer')) {
        $t = Normalizer::normalize($s, Normalizer::FORM_KD);
        if (is_string($t)) {
            $s = $t;
        }
    }
    $s = mb_strtolower($s, 'UTF-8');
    $s = (string) preg_replace('/[\x{0300}-\x{036F}\x{064B}-\x{065F}\x{0670}\x{0640}\x{200B}-\x{200F}]/u', '', $s);
    return strtr($s, array(
        'أ' => 'ا', 'إ' => 'ا', 'آ' => 'ا', 'ٱ' => 'ا', 'ة' => 'ه', 'ى' => 'ي', 'ؤ' => 'و', 'ئ' => 'ي',
        // in case the intl extension is missing
        'à' => 'a', 'á' => 'a', 'â' => 'a', 'ã' => 'a', 'ä' => 'a', 'å' => 'a', 'ā' => 'a', 'ç' => 'c', 'è' => 'e', 'é' => 'e',
        'ê' => 'e', 'ë' => 'e', 'ē' => 'e', 'ì' => 'i', 'í' => 'i', 'î' => 'i', 'ï' => 'i', 'ñ' => 'n', 'ò' => 'o', 'ó' => 'o',
        'ô' => 'o', 'õ' => 'o', 'ö' => 'o', 'ø' => 'o', 'ù' => 'u', 'ú' => 'u', 'û' => 'u', 'ü' => 'u', 'ý' => 'y', 'ÿ' => 'y',
        'š' => 's', 'ž' => 'z', 'ğ' => 'g', 'ı' => 'i', 'ł' => 'l'
    ));
}

function name_dedup(string $s): string
{
    return (string) preg_replace('/(.)\1+/u', '$1', $s);
}

function is_rude(string $name): bool
{
    $L = name_lists();
    if ($L === null) {
        return true;   // lists missing: refuse rather than let anything through
    }
    $raw = name_fold($name);
    $leet = strtr($raw, array('0' => 'o', '1' => 'i', '3' => 'e', '4' => 'a', '5' => 's', '7' => 't', '8' => 'b', '9' => 'g',
        '@' => 'a', '$' => 's', '!' => 'i', '|' => 'i', '€' => 'e', '+' => 't'));
    foreach (array($raw, $leet) as $v) {
        $squash = (string) preg_replace('/[^\p{L}\p{N}]+/u', '', $v);
        if ($squash === '') {
            continue;
        }
        $squashD = name_dedup($squash);
        foreach ($L['any'] as $w) {
            if (mb_strpos($squash, $w, 0, 'UTF-8') !== false) {
                return true;
            }
        }
        foreach ($L['anyD'] as $w) {
            if (mb_strpos($squashD, $w, 0, 'UTF-8') !== false) {
                return true;
            }
        }
        $tokens = preg_split('/[^\p{L}\p{N}]+/u', $v, -1, PREG_SPLIT_NO_EMPTY) ?: array();
        $tokens[] = $squash;                                      // "a y r e" reads as one word
        foreach ($tokens as $t) {
            foreach (array(array($t, 'word', 'start'), array(name_dedup($t), 'wordD', 'startD')) as $form) {
                list($x, $wl, $sl) = $form;
                $bare = (string) preg_replace('/\d+$/u', '', $x);   // "ayre123" -> "ayre"
                if (isset($L[$wl][$x]) || ($bare !== '' && isset($L[$wl][$bare]))) {
                    return true;
                }
                foreach ($L[$sl] as $w) {
                    if (mb_strpos($x, (string) $w, 0, 'UTF-8') === 0) {
                        return true;
                    }
                }
            }
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
    if (is_rude($name) || is_blocked($name)) {
        return 'Please pick a different name.';
    }
    return null;
}

/* names Cezar has blocked from the admin page */
function is_blocked(string $name): bool
{
    static $b = null;
    if ($b === null) {
        $b = read_json('blocked.json', array());
    }
    return isset($b[name_key($name)]);
}

/* ------------------------------------------------------------------ contact (private, optional) */
function clean_contact(string $raw): string
{
    return mb_substr(clean_name($raw), 0, 40, 'UTF-8');
}

function valid_contact(string $c): ?string
{
    if ($c === '') {
        return null;
    }
    if (preg_match('/^[\p{L}\p{N} +@._()\/-]+$/u', $c) !== 1 || preg_match_all('/[\p{L}\p{N}]/u', $c) < 3) {
        return 'Use a phone number, an Instagram handle or an email.';
    }
    return null;
}

/* ------------------------------------------------------------------ activity counts */
function beirut_day(int $ts): string
{
    $d = new DateTime('@' . $ts);
    $d->setTimezone(new DateTimeZone(TZ));
    return $d->format('Y-m-d');
}

function from_site(): bool
{
    $o = isset($_SERVER['HTTP_ORIGIN']) ? (string) $_SERVER['HTTP_ORIGIN'] : '';
    return in_array($o, ALLOWED_ORIGINS, true);
}

// $what: 'starts' or 'saves'. Called inside with_lock() for saves; takes the lock itself for starts.
function bump_stats(string $what, bool $site): void
{
    $now = time();
    $st = read_json('stats.json', array('days' => array()));
    $day = beirut_day($now);
    if (!isset($st['days'][$day])) {
        $st['days'][$day] = array('starts' => 0, 'saves' => 0, 'site' => 0);
    }
    $st['days'][$day][$what] = (int) $st['days'][$day][$what] + 1;
    if ($what === 'starts' && $site) {
        $st['days'][$day]['site'] = (int) $st['days'][$day]['site'] + 1;
        $st['lastSite'] = $now;
    }
    if (count($st['days']) > 120) {
        ksort($st['days']);
        $st['days'] = array_slice($st['days'], -120, null, true);
    }
    write_json('stats.json', $st);
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

/* ------------------------------------------------------------------ site analytics
   One small JSON file per day (Beirut time) in jeetak-rush-data/analytics/.
   Visitors are told apart for one day only, by a keyed hash of IP and browser
   whose key is replaced every day and then deleted, so no IP address is stored
   and nobody can be followed from one day to the next. No cookies. */
const KILL_KINDS = array('hole', 'manhole', 'goat', 'goats', 'snowman', 'car', 'van', 'truck');

function analytics_blank(): array
{
    return array(
        'views' => 0, 'u' => array(), 'ref' => array(), 'utm' => array(), 'dev' => array(), 'tz' => array(),
        'time' => 0.0, 'sec' => array(), 'item' => array(),
        'depth' => array('25' => 0, '50' => 0, '75' => 0, '100' => 0),
        'click' => array(),
        'game' => array('starts' => 0, 'runs' => 0, 'saved' => 0, 'secs' => 0.0, 'best' => 0, 'score' => array(), 'kind' => array(), 'reach' => array()),
        'rl' => array(),
    );
}

function analytics_file(string $day): string
{
    $dir = data_dir() . '/analytics';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    return 'analytics/' . $day . '.json';
}

function analytics_read(string $day): ?array
{
    $d = read_json(analytics_file($day), null);
    if (!is_array($d)) {
        return null;
    }
    $d = array_replace(analytics_blank(), $d);
    $d['game'] = array_replace(analytics_blank()['game'], (array) $d['game']);
    return $d;
}

// a stand-in for "the same visitor today": keyed hash, key replaced daily
function visitor_today(string $day): string
{
    $dir = data_dir() . '/analytics';
    $f = $dir . '/.key-' . $day;
    if (!is_file($f)) {
        file_put_contents($f, bin2hex(random_bytes(16)));
        @chmod($f, 0600);
        foreach (glob($dir . '/.key-*') ?: array() as $old) {
            if ($old !== $f && filemtime($old) < time() - 86400) {
                @unlink($old);
            }
        }
    }
    $ip = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '0';
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $ip = trim(explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
    }
    $ua = isset($_SERVER['HTTP_USER_AGENT']) ? substr((string) $_SERVER['HTTP_USER_AGENT'], 0, 200) : '';
    return substr(hash_hmac('sha256', $ip . '|' . $ua, (string) file_get_contents($f)), 0, 16);
}

function clip(string $s, int $n): string
{
    return mb_substr(clean_name($s), 0, $n, 'UTF-8');
}

function bump(array &$m, string $k, $by = 1, int $cap = 150): void
{
    if ($k === '') {
        return;
    }
    if (!isset($m[$k]) && count($m) >= $cap) {
        $k = 'Other';
    }
    $m[$k] = (isset($m[$k]) ? $m[$k] : 0) + $by;
}

// [seconds on screen, visits that saw it]
function bump_seen(array &$m, string $k, float $secs, int $visits, int $cap = 80): void
{
    if ($k === '' || (!isset($m[$k]) && count($m) >= $cap)) {
        return;
    }
    if (!isset($m[$k])) {
        $m[$k] = array(0.0, 0);
    }
    $m[$k][0] = round((float) $m[$k][0] + $secs, 1);
    $m[$k][1] = (int) $m[$k][1] + $visits;
}

function score_band(int $s): string
{
    if ($s < 250) {
        return 'Under 250';
    }
    if ($s < 500) {
        return '250 to 499';
    }
    if ($s < 1000) {
        return '500 to 999';
    }
    if ($s < 2000) {
        return '1,000 to 1,999';
    }
    if ($s < 5000) {
        return '2,000 to 4,999';
    }
    return '5,000 and up';
}

// Record one event from the page. Call inside with_lock().
function analytics_record(array $in): void
{
    $e = (string) ($in['e'] ?? '');
    if (!in_array($e, array('view', 'time', 'click', 'gstart', 'grun', 'saved'), true)) {
        return;
    }
    $day = beirut_day(time());
    $d = analytics_read($day) ?? analytics_blank();
    if ($e !== 'saved') {
        $who = visitor_today($day);
        $d['rl'][$who] = (int) ($d['rl'][$who] ?? 0) + 1;
        if ($d['rl'][$who] > 800) {
            return;   // one browser cannot flood the numbers
        }
    }
    switch ($e) {
        case 'view':
            $d['views']++;
            $d['u'][$who] = 1;
            $ref = clip((string) ($in['ref'] ?? ''), 60);
            bump($d['ref'], $ref === '' ? 'Direct, WhatsApp or an app' : $ref);
            $utm = trim(clip((string) ($in['us'] ?? ''), 30) . ' / ' . clip((string) ($in['um'] ?? ''), 30) . ' / ' . clip((string) ($in['uc'] ?? ''), 40), ' /');
            if ($utm !== '') {
                bump($d['utm'], $utm);
            }
            $dev = (string) ($in['dev'] ?? '');
            bump($d['dev'], in_array($dev, array('Phone', 'Tablet', 'Computer'), true) ? $dev : 'Other');
            $tz = (string) ($in['tz'] ?? '');
            bump($d['tz'], preg_match('~^[A-Za-z_]+(/[A-Za-z_\-+0-9]+){0,2}$~', $tz) ? $tz : 'Unknown');
            break;
        case 'time':
            $t = min(3600.0, max(0.0, (float) ($in['t'] ?? 0)));
            $d['time'] = round((float) $d['time'] + $t, 1);
            foreach (array('sec', 'item') as $kind) {
                foreach ((array) ($in[$kind] ?? array()) as $name => $secs) {
                    bump_seen($d[$kind], clip((string) $name, 40), min($t + 5, max(0.0, (float) $secs)), 0);
                }
            }
            foreach ((array) ($in['first'] ?? array()) as $f) {
                $parts = explode('|', (string) $f, 2);
                if (count($parts) === 2 && ($parts[0] === 'sec' || $parts[0] === 'item')) {
                    bump_seen($d[$parts[0]], clip($parts[1], 40), 0.0, 1);
                }
            }
            foreach ((array) ($in['depth'] ?? array()) as $q) {
                $q = (string) (int) $q;
                if (isset($d['depth'][$q])) {
                    $d['depth'][$q]++;
                }
            }
            break;
        case 'click':
            $k = clip((string) ($in['k'] ?? ''), 60);
            $s = clip((string) ($in['s'] ?? ''), 30);
            bump($d['click'], $k . ($s !== '' ? ' · ' . $s : ''), 1, 200);
            break;
        case 'gstart':
            $d['game']['starts']++;
            break;
        case 'grun':
            $score = max(0, min(5000000, (int) ($in['score'] ?? 0)));
            $d['game']['runs']++;
            $d['game']['secs'] = round((float) $d['game']['secs'] + min(3600.0, max(0.0, (float) ($in['time'] ?? 0))), 1);
            $d['game']['best'] = max((int) $d['game']['best'], $score);
            bump($d['game']['score'], score_band($score));
            $kind = (string) ($in['kind'] ?? '');
            bump($d['game']['kind'], in_array($kind, KILL_KINDS, true) ? $kind : 'other');
            bump($d['game']['reach'], clip((string) ($in['village'] ?? ''), 24), 1, 40);
            break;
        case 'saved':
            $d['game']['saved']++;
            break;
    }
    write_json(analytics_file($day), $d);
}

// Totals over the last $days days, plus the daily series for the chart.
function analytics_range(int $days): array
{
    $agg = analytics_blank();
    $agg['visitors'] = 0;
    $agg['series'] = array();
    for ($i = $days - 1; $i >= 0; $i--) {
        $day = beirut_day(time() - $i * 86400);
        $d = analytics_read($day);
        $agg['series'][$day] = array($d ? count($d['u']) : 0, $d ? (int) $d['views'] : 0);
        if (!$d) {
            continue;
        }
        $agg['views'] += (int) $d['views'];
        $agg['visitors'] += count($d['u']);
        $agg['time'] += (float) $d['time'];
        foreach (array('ref', 'utm', 'dev', 'tz', 'click') as $k) {
            foreach ($d[$k] as $name => $n) {
                $agg[$k][$name] = ($agg[$k][$name] ?? 0) + (int) $n;
            }
        }
        foreach (array('sec', 'item') as $k) {
            foreach ($d[$k] as $name => $pair) {
                $agg[$k][$name] = array(($agg[$k][$name][0] ?? 0) + (float) $pair[0], ($agg[$k][$name][1] ?? 0) + (int) $pair[1]);
            }
        }
        foreach ($d['depth'] as $q => $n) {
            $agg['depth'][$q] += (int) $n;
        }
        foreach (array('starts', 'runs', 'saved') as $k) {
            $agg['game'][$k] += (int) $d['game'][$k];
        }
        $agg['game']['secs'] += (float) $d['game']['secs'];
        $agg['game']['best'] = max($agg['game']['best'], (int) $d['game']['best']);
        foreach (array('score', 'kind', 'reach') as $k) {
            foreach ((array) $d['game'][$k] as $name => $n) {
                $agg['game'][$k][$name] = ($agg['game'][$k][$name] ?? 0) + (int) $n;
            }
        }
    }
    unset($agg['u'], $agg['rl']);
    return $agg;
}
