<?php
/*
 * Jeetak Rush leaderboard admin: everyone who saved a score, their private
 * contact (if they left one), delete or block names, download a CSV.
 *
 * Sign-in uses a password whose bcrypt hash is below. Only the hash is in
 * this public repository; the password itself was given to Cezar.
 */

declare(strict_types=1);
define('JR', 1);
require __DIR__ . '/lib.php';

const ADMIN_HASH = '$2y$11$R6Hrg5g26wjvvw9KH4e8I.9/LS.0WsTCJ.wsxlBhETcQA8dhhpYA6';
const SESSION_DAYS = 30;
const COOKIE = 'jr_admin';

header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('X-Robots-Tag: noindex, nofollow');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");

$self = strtok((string) ($_SERVER['REQUEST_URI'] ?? 'admin.php'), '?') ?: 'admin.php';

/* ------------------------------------------------------------------ session */
function session_key(): string
{
    return hash_hmac('sha256', 'admin-session|' . ADMIN_HASH, secret(), true);
}

function session_make(): string
{
    $p = b64u((string) json_encode(array('e' => time() + SESSION_DAYS * 86400, 'n' => bin2hex(random_bytes(8)))));
    return $p . '.' . b64u(hash_hmac('sha256', $p, session_key(), true));
}

function session_ok(): bool
{
    $c = isset($_COOKIE[COOKIE]) ? (string) $_COOKIE[COOKIE] : '';
    $parts = explode('.', $c);
    if (count($parts) !== 2 || !hash_equals(b64u(hash_hmac('sha256', $parts[0], session_key(), true)), $parts[1])) {
        return false;
    }
    $p = json_decode(unb64u($parts[0]), true);
    return is_array($p) && isset($p['e']) && (int) $p['e'] > time();
}

function csrf(): string
{
    return b64u(hash_hmac('sha256', 'csrf|' . (string) ($_COOKIE[COOKIE] ?? ''), secret(), true));
}

function set_cookie(string $value, int $expires): void
{
    setcookie(COOKIE, $value, array(
        'expires' => $expires, 'path' => '/', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true, 'samesite' => 'Strict',
    ));
}

// a WhatsApp link for a phone number; Lebanese numbers may be typed without +961
function wa_number(string $p): string
{
    if (preg_match('/^[+\d\s().\/-]+$/', $p) !== 1) {
        return '';
    }
    $d = (string) preg_replace('/\D+/', '', $p);
    if (strpos($d, '00') === 0) {
        $d = substr($d, 2);
    }
    if (strlen($d) === 8 && $d[0] === '0') {
        $d = '961' . substr($d, 1);            // 03 123 456
    } elseif (strlen($d) === 8 && ($d[0] === '7' || $d[0] === '8')) {
        $d = '961' . $d;                       // 71 123 456
    } elseif (strlen($d) === 7 && $d[0] === '3') {
        $d = '961' . $d;                       // 3 123 456
    }
    return strlen($d) >= 8 && strlen($d) <= 15 ? $d : '';
}

// where to reach a contact: WhatsApp for phone numbers, Instagram for handles, email
function contact_link(string $p): string
{
    if ($p === '') {
        return '';
    }
    $wa = wa_number($p);
    if ($wa !== '') {
        return 'https://wa.me/' . $wa;
    }
    if (preg_match('/^@?[A-Za-z0-9._]{2,30}$/', $p)) {
        return 'https://instagram.com/' . ltrim($p, '@');
    }
    if (filter_var($p, FILTER_VALIDATE_EMAIL)) {
        return 'mailto:' . $p;
    }
    return '';
}

function h(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function when(int $ts): string
{
    if ($ts <= 0) {
        return '';
    }
    $d = new DateTime('@' . $ts);
    $d->setTimezone(new DateTimeZone(TZ));
    return $d->format('j M Y, H:i');
}

function ago(int $ts): string
{
    if ($ts <= 0) {
        return 'not yet';
    }
    $s = time() - $ts;
    if ($s < 90) {
        return 'just now';
    }
    if ($s < 5400) {
        return round($s / 60) . ' min ago';
    }
    if ($s < 172800) {
        return round($s / 3600) . ' h ago';
    }
    return round($s / 86400) . ' days ago';
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));

/* ------------------------------------------------------------------ sign in / out */
if ($method === 'POST' && isset($_POST['login'])) {
    $who = client_hash();
    $fails = with_lock(function () use ($who) {
        $f = read_json('admin-fails.json', array());
        $now = time();
        foreach ($f as $k => $list) {
            $f[$k] = array_values(array_filter((array) $list, function ($t) use ($now) { return $now - (int) $t < 3600; }));
            if (!$f[$k]) {
                unset($f[$k]);
            }
        }
        write_json('admin-fails.json', $f);
        return isset($f[$who]) ? count($f[$who]) : 0;
    });
    $error = '';
    if ($fails >= 8) {
        $error = 'Too many tries. Wait an hour and try again.';
    } elseif (password_verify((string) ($_POST['key'] ?? ''), ADMIN_HASH)) {
        set_cookie(session_make(), time() + SESSION_DAYS * 86400);
        header('Location: ' . $self, true, 303);
        exit;
    } else {
        with_lock(function () use ($who) {
            $f = read_json('admin-fails.json', array());
            $f[$who][] = time();
            write_json('admin-fails.json', $f);
        });
        usleep(400000);
        $error = 'That password is not right.';
    }
    page_login($error);
}

if ($method === 'POST' && isset($_POST['logout'])) {
    set_cookie('', time() - 3600);
    header('Location: ' . $self, true, 303);
    exit;
}

if (!session_ok()) {
    page_login('');
}

/* ------------------------------------------------------------------ actions */
if ($method === 'POST') {
    if (!hash_equals(csrf(), (string) ($_POST['csrf'] ?? ''))) {
        http_response_code(400);
        exit('This form expired. Go back and reload the page.');
    }
    $do = (string) ($_POST['do'] ?? '');
    $key = (string) ($_POST['k'] ?? '');
    $done = with_lock(function () use ($do, $key) {
        $board = read_json('board.json', array());
        $blocked = read_json('blocked.json', array());
        if ($do === 'unblock') {
            unset($blocked[$key]);
            write_json('blocked.json', $blocked);
            return 'unblocked';
        }
        $name = '';
        $board = array_values(array_filter($board, function ($e) use ($key, &$name) {
            if ((string) $e['k'] === $key) {
                $name = (string) $e['n'];
                return false;
            }
            return true;
        }));
        write_json('board.json', $board);
        if ($do === 'block' && $key !== '') {
            $blocked[$key] = array('n' => $name !== '' ? $name : $key, 't' => time());
            write_json('blocked.json', $blocked);
            return 'blocked';
        }
        return 'deleted';
    });
    header('Location: ' . $self . '?done=' . $done, true, 303);
    exit;
}

$board = read_json('board.json', array());
$blocked = read_json('blocked.json', array());

/* ------------------------------------------------------------------ CSV */
if (isset($_GET['export']) && $_GET['export'] === 'csv') {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="jeetak-rush-players-' . beirut_day(time()) . '.csv"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");   // so Excel reads Arabic names correctly
    $safe = function ($v) {
        $v = (string) $v;
        return preg_match('/^[=+\-@\t\r]/', $v) ? "'" . $v : $v;   // stop spreadsheet formulas
    };
    fputcsv($out, array('Rank', 'Name', 'Score', 'Reached', 'Lira', 'Phoenician', 'Villages', 'Saved (Beirut)', 'Contact', 'Message them'));
    foreach ($board as $i => $e) {
        $p = (string) ($e['p'] ?? '');
        fputcsv($out, array($i + 1, $safe($e['n']), $e['s'], $safe($e['v']), $e['c'], $e['r'], $e['d'], when((int) $e['t']), $safe($p), contact_link($p)));
    }
    fclose($out);
    exit;
}

/* ------------------------------------------------------------------ page */
$stats = read_json('stats.json', array('days' => array()));
$today = beirut_day(time());
$day = isset($stats['days'][$today]) ? $stats['days'][$today] : array('starts' => 0, 'saves' => 0, 'site' => 0);
$week = array('starts' => 0, 'saves' => 0);
for ($i = 0; $i < 7; $i++) {
    $d = beirut_day(time() - $i * 86400);
    if (isset($stats['days'][$d])) {
        $week['starts'] += (int) $stats['days'][$d]['starts'];
        $week['saves'] += (int) $stats['days'][$d]['saves'];
    }
}
$withContact = count(array_filter($board, function ($e) { return !empty($e['p']); }));
$done = (string) ($_GET['done'] ?? '');
$notice = array('deleted' => 'Removed from the leaderboard.', 'blocked' => 'Removed, and that name can no longer be used.', 'unblocked' => 'That name can be used again.');
$csrf = csrf();

page_head('Jeetak Rush admin');
?>
<header class="top">
  <div>
    <p class="kicker">Jeetak Rush</p>
    <h1>Leaderboard admin</h1>
  </div>
  <div class="actions">
    <a class="btn" href="<?= h($self) ?>?export=csv">Download CSV</a>
    <form method="post"><button class="btn ghost" name="logout" value="1">Sign out</button></form>
  </div>
</header>

<?php if (isset($notice[$done])): ?><p class="notice"><?= h($notice[$done]) ?></p><?php endif; ?>

<section class="cards">
  <div class="card"><b><?= (int) $day['starts'] ?></b><span>games today</span></div>
  <div class="card"><b><?= (int) $day['saves'] ?></b><span>scores saved today</span></div>
  <div class="card"><b><?= (int) $week['starts'] ?></b><span>games in the last 7 days</span></div>
  <div class="card"><b><?= count($board) ?></b><span>players on the board, <?= $withContact ?> with contact</span></div>
  <div class="card wide"><b><?= h(ago((int) ($stats['lastSite'] ?? 0))) ?></b><span>last game started on pixelabs.tech</span></div>
</section>

<section>
  <div class="bar">
    <h2>Everyone who saved a score</h2>
    <input id="q" type="search" placeholder="Search names, villages, contacts" aria-label="Search">
  </div>
  <?php if (!$board): ?>
    <p class="empty">No scores yet. They appear here as soon as someone saves one on pixelabs.tech.</p>
  <?php else: ?>
  <div class="scroll">
    <table id="t">
      <thead><tr><th>#</th><th>Name</th><th class="num">Score</th><th>Reached</th><th class="num">Lira</th><th class="num">Phoen.</th><th>Saved</th><th>Contact</th><th></th></tr></thead>
      <tbody>
      <?php foreach ($board as $i => $e): ?>
        <tr class="<?= $i < 3 ? 'podium' : '' ?>">
          <td class="rank"><?= $i + 1 ?></td>
          <td class="name" dir="auto"><?= h((string) $e['n']) ?></td>
          <td class="num"><?= number_format((int) $e['s']) ?></td>
          <td><?= h((string) $e['v']) ?></td>
          <td class="num"><?= (int) $e['c'] ?></td>
          <td class="num"><?= (int) $e['r'] ?></td>
          <td class="when"><?= h(when((int) $e['t'])) ?></td>
          <td class="contact" dir="auto"><?php
            $p = (string) ($e['p'] ?? '');
            $link = contact_link($p);
            if ($p === '') {
                echo '<span class="dim">none</span>';
            } elseif ($link !== '') {
                echo '<a href="' . h($link) . '" target="_blank" rel="noopener">' . h($p) . '</a>';
            } else {
                echo h($p);
            }
          ?></td>
          <td class="row-actions">
            <form method="post" onsubmit="return confirm(this.dataset.q)" data-q="Remove <?= h((string) $e['n']) ?> from the leaderboard?">
              <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="k" value="<?= h((string) $e['k']) ?>">
              <button name="do" value="delete">Delete</button>
            </form>
            <form method="post" onsubmit="return confirm(this.dataset.q)" data-q="Remove <?= h((string) $e['n']) ?> and stop anyone using that name again?">
              <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="k" value="<?= h((string) $e['k']) ?>">
              <button name="do" value="block" class="warn">Block name</button>
            </form>
          </td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
  </div>
  <?php endif; ?>
</section>

<section>
  <h2>Blocked names</h2>
  <?php if (!$blocked): ?>
    <p class="empty">None. Blocking a name removes it and stops it being used again. Rude words are already refused automatically.</p>
  <?php else: ?>
    <ul class="chips">
    <?php foreach ($blocked as $k => $b): ?>
      <li><span dir="auto"><?= h((string) ($b['n'] ?? $k)) ?></span>
        <form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="k" value="<?= h((string) $k) ?>"><button name="do" value="unblock">Unblock</button></form>
      </li>
    <?php endforeach; ?>
    </ul>
  <?php endif; ?>
</section>

<p class="foot">Names are public on pixelabs.tech. Contact details are private and only shown here. Times are Beirut time.</p>
<script>
  (function () {
    var q = document.getElementById('q'), rows = document.querySelectorAll('#t tbody tr');
    if (!q) return;
    q.addEventListener('input', function () {
      var v = q.value.trim().toLowerCase();
      rows.forEach(function (r) { r.hidden = v && r.textContent.toLowerCase().indexOf(v) < 0; });
    });
  })();
</script>
<?php
page_foot();

/* ------------------------------------------------------------------ templates */
function page_head(string $title): void
{
    header('Content-Type: text/html; charset=utf-8');
    ?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title><?= h($title) ?></title>
<style>
  :root { --bg: #10241B; --panel: #17311F; --line: rgba(255,250,230,.14); --cream: #FFFAE6; --dim: #C9D2C3; --orange: #E23C0E; --lit: #FF7A45; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--cream); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 20px 16px 48px; }
  main { max-width: 1180px; margin: 0 auto; display: grid; gap: 28px; }
  h1 { margin: 0; font-size: 1.7rem; font-style: italic; letter-spacing: -.01em; }
  h2 { margin: 0 0 12px; font-size: 1.15rem; }
  a { color: var(--lit); }
  .kicker { margin: 0 0 4px; font-size: .75rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--lit); }
  .top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: end; gap: 14px; }
  .actions { display: flex; gap: 10px; align-items: center; }
  .actions form { margin: 0; }
  .btn { display: inline-flex; align-items: center; min-height: 40px; padding: 0 16px; border-radius: 8px; border: 0; background: var(--lit); color: #10241B; font: 600 .92rem system-ui, sans-serif; text-decoration: none; cursor: pointer; }
  .btn.ghost { background: transparent; color: var(--cream); box-shadow: inset 0 0 0 1px var(--line); }
  .notice { margin: 0; padding: 10px 14px; border-radius: 10px; background: rgba(155,229,176,.12); color: #9BE5B0; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
  .card { padding: 14px 16px; border-radius: 12px; background: var(--panel); border: 1px solid var(--line); display: grid; gap: 2px; }
  .card b { font-size: 1.5rem; line-height: 1.1; }
  .card span { color: var(--dim); font-size: .85rem; }
  .bar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; }
  .bar h2 { margin: 0; }
  input[type=search], input[type=password] { height: 42px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--line); background: #0B1A14; color: var(--cream); font: inherit; min-width: 240px; }
  .scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; }
  table { width: 100%; border-collapse: collapse; min-width: 860px; }
  th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: middle; }
  th { font-size: .75rem; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); background: var(--panel); position: sticky; top: 0; }
  tr:last-child td { border-bottom: 0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .rank { font-weight: 700; color: var(--lit); width: 3em; }
  .podium { background: rgba(226,60,14,.1); }
  .name { font-weight: 600; unicode-bidi: plaintext; }
  .contact { unicode-bidi: plaintext; }
  .when { white-space: nowrap; color: var(--dim); font-size: .88rem; }
  .dim { color: var(--dim); opacity: .6; }
  .row-actions { white-space: nowrap; text-align: right; }
  .row-actions form, .chips form { display: inline; margin: 0; }
  .row-actions button, .chips button { min-height: 32px; padding: 0 10px; border-radius: 7px; border: 1px solid var(--line); background: transparent; color: var(--cream); font: 600 .82rem system-ui, sans-serif; cursor: pointer; }
  .row-actions button.warn { border-color: rgba(255,122,69,.5); color: var(--lit); }
  .empty { margin: 0; color: var(--dim); }
  .chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
  .chips li { display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 12px; border-radius: 999px; background: var(--panel); border: 1px solid var(--line); }
  .foot { margin: 0; color: var(--dim); font-size: .85rem; }
  .login { max-width: 380px; margin: 12vh auto 0; padding: 26px; border-radius: 16px; background: var(--panel); border: 1px solid var(--line); display: grid; gap: 14px; }
  .login input { width: 100%; min-width: 0; }
  .err { margin: 0; color: #FFB59A; }
  @media (max-width: 560px) { input[type=search] { min-width: 0; width: 100%; } .bar { align-items: stretch; } }
</style>
</head>
<body><main>
<?php
}

function page_foot(): void
{
    echo "</main></body></html>\n";
    exit;
}

function page_login(string $error): void
{
    page_head('Jeetak Rush admin');
    ?>
<form class="login" method="post" autocomplete="on">
  <div>
    <p class="kicker">Jeetak Rush</p>
    <h1>Leaderboard admin</h1>
  </div>
  <label for="key">Password</label>
  <input id="key" name="key" type="password" autocomplete="current-password" required autofocus>
  <?php if ($error !== ''): ?><p class="err"><?= h($error) ?></p><?php endif; ?>
  <button class="btn" name="login" value="1">Sign in</button>
</form>
<?php
    page_foot();
}
