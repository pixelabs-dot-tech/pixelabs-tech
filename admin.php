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

/* ------------------------------------------------------------------ pages */
$view = (string) ($_GET['view'] ?? 'players');
if ($view === 'analytics') {
    $range = (int) ($_GET['range'] ?? 7);
    page_analytics(in_array($range, array(1, 7, 30, 90), true) ? $range : 7);
}

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
<?php page_top('players'); ?>

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

/* ------------------------------------------------------------------ shared top bar */
function page_top(string $tab): void
{
    global $self;
    ?>
<header class="top">
  <div>
    <p class="kicker">pixelabs.tech</p>
    <h1><?= $tab === 'players' ? 'Jeetak Rush players' : 'Site analytics' ?></h1>
  </div>
  <div class="actions">
    <?php if ($tab === 'players'): ?><a class="btn" href="<?= h($self) ?>?export=csv">Download CSV</a><?php endif; ?>
    <form method="post"><button class="btn ghost" name="logout" value="1">Sign out</button></form>
  </div>
</header>
<nav class="tabs" aria-label="Admin sections">
  <a href="<?= h($self) ?>" <?= $tab === 'players' ? 'aria-current="page"' : '' ?>>Players</a>
  <a href="<?= h($self) ?>?view=analytics" <?= $tab === 'analytics' ? 'aria-current="page"' : '' ?>>Analytics</a>
</nav>
<?php
}

/* ------------------------------------------------------------------ analytics */
function dur(float $s): string
{
    $s = (int) round($s);
    if ($s < 60) {
        return $s . ' s';
    }
    if ($s < 3600) {
        return intdiv($s, 60) . ' min' . ($s % 60 ? ' ' . ($s % 60) . ' s' : '');
    }
    return intdiv($s, 3600) . ' h' . (intdiv($s % 3600, 60) ? ' ' . intdiv($s % 3600, 60) . ' min' : '');
}

function pct(float $part, float $whole): string
{
    return $whole > 0 ? round($part / $whole * 100) . '%' : '0%';
}

function compact_n(float $n): string
{
    if ($n >= 10000) {
        return round($n / 1000) . 'K';
    }
    if ($n >= 1000) {
        return round($n / 1000, 1) . 'K';
    }
    return (string) (int) $n;
}

// One horizontal bar per row: [label, value used for the bar, text shown at the bar's end]
function bars(array $rows, string $empty, int $limit = 12, bool $longLabels = false): void
{
    if (!$rows) {
        echo '<p class="empty">' . h($empty) . '</p>';
        return;
    }
    $rows = array_slice($rows, 0, $limit);
    $max = max(array_map(function ($r) { return (float) $r[1]; }, $rows)) ?: 1;
    echo '<ul class="bars' . ($longLabels ? ' long' : '') . '">';
    foreach ($rows as $r) {
        $w = (float) $r[1] > 0 ? max(0.8, (float) $r[1] / $max * 100) : 0;
        echo '<li><span class="bl" dir="auto">' . h((string) $r[0]) . '</span>'
            . '<span class="bt"><i style="width:' . round($w, 2) . '%"></i></span>'
            . '<span class="bv">' . h((string) $r[2]) . '</span></li>';
    }
    echo '</ul>';
}

function sorted_counts(array $m): array
{
    arsort($m);
    $rows = array();
    foreach ($m as $k => $n) {
        $rows[] = array($k, $n, number_format((int) $n));
    }
    return $rows;
}

function tz_label(string $tz): string
{
    $city = str_replace('_', ' ', substr((string) strrchr('/' . $tz, '/'), 1));
    $country = array('Beirut' => 'Lebanon', 'Dubai' => 'UAE', 'Riyadh' => 'Saudi Arabia', 'Qatar' => 'Qatar', 'Kuwait' => 'Kuwait',
        'Paris' => 'France', 'London' => 'UK', 'Berlin' => 'Germany', 'Montreal' => 'Canada', 'Toronto' => 'Canada',
        'New York' => 'US East', 'Los Angeles' => 'US West', 'Chicago' => 'US Central', 'Sydney' => 'Australia',
        'Lagos' => 'Nigeria', 'Abidjan' => 'Ivory Coast', 'Amman' => 'Jordan', 'Damascus' => 'Syria', 'Cairo' => 'Egypt',
        'Istanbul' => 'Turkey', 'Nicosia' => 'Cyprus', 'Athens' => 'Greece', 'Sao Paulo' => 'Brazil');
    return isset($country[$city]) ? $city . ' (' . $country[$city] . ')' : ($city !== '' ? $city : $tz);
}

function column_chart(array $series): void
{
    $n = count($series);
    $max = 1;
    foreach ($series as $v) {
        $max = max($max, (int) $v[0]);
    }
    $top = (int) ceil($max / 2) * 2 ?: 2;
    $W = (int) max(420, min(1000, $n * 34)); $H = 170; $pad = 30; $axis = 22;
    $slot = ($W - $pad) / $n;
    $bw = min(24, max(3, $slot * 0.62));
    echo '<figure class="chart"><div class="chart-scroll"><svg viewBox="0 0 ' . $W . ' ' . ($H + $axis) . '" style="min-width:' . (int) round($W * 0.6) . 'px" role="img" aria-label="Visitors per day">';
    foreach (array(0, $top / 2, $top) as $tick) {
        $y = $H - $tick / $top * ($H - 10);
        echo '<line x1="' . $pad . '" x2="' . $W . '" y1="' . round($y, 1) . '" y2="' . round($y, 1) . '" class="grid"/>';
        echo '<text x="' . ($pad - 6) . '" y="' . round($y + 4, 1) . '" class="tick" text-anchor="end">' . compact_n($tick) . '</text>';
    }
    $i = 0;
    $labelEvery = max(1, (int) ceil($n / 7));
    foreach ($series as $day => $v) {
        $x = $pad + $slot * $i + ($slot - $bw) / 2;
        $hgt = (int) $v[0] / $top * ($H - 10);
        $date = DateTime::createFromFormat('Y-m-d', $day, new DateTimeZone(TZ));
        $nice = $date ? $date->format('D j M') : $day;
        $tip = $nice . ': ' . (int) $v[0] . ' visitor' . ((int) $v[0] === 1 ? '' : 's') . ', ' . (int) $v[1] . ' page view' . ((int) $v[1] === 1 ? '' : 's');
        echo '<g class="col" tabindex="0" data-tip="' . h($tip) . '" aria-label="' . h($tip) . '">';
        echo '<rect class="hit" x="' . round($pad + $slot * $i, 1) . '" y="0" width="' . round($slot, 1) . '" height="' . $H . '"/>';
        if ($hgt > 0) {
            $r = min(4, $hgt, $bw / 2);
            $x2 = $x + $bw; $y0 = $H; $y1 = $H - $hgt;
            echo '<path class="bar" d="M' . round($x, 1) . ' ' . $y0 . 'V' . round($y1 + $r, 1) . 'Q' . round($x, 1) . ' ' . round($y1, 1) . ' ' . round($x + $r, 1) . ' ' . round($y1, 1)
                . 'H' . round($x2 - $r, 1) . 'Q' . round($x2, 1) . ' ' . round($y1, 1) . ' ' . round($x2, 1) . ' ' . round($y1 + $r, 1) . 'V' . $y0 . 'Z"/>';
        }
        echo '</g>';
        if ($i % $labelEvery === 0 || $i === $n - 1) {
            echo '<text x="' . round($pad + $slot * $i + $slot / 2, 1) . '" y="' . ($H + 16) . '" class="tick" text-anchor="middle">' . h($date ? $date->format('j M') : $day) . '</text>';
        }
        $i++;
    }
    echo '<line x1="' . $pad . '" x2="' . $W . '" y1="' . $H . '" y2="' . $H . '" class="base"/>';
    echo '</svg></div><div class="tip" hidden></div></figure>';
    echo '<details class="tableview"><summary>Show as a table</summary><table><thead><tr><th>Day</th><th class="num">Visitors</th><th class="num">Page views</th></tr></thead><tbody>';
    foreach (array_reverse($series, true) as $day => $v) {
        echo '<tr><td>' . h($day) . '</td><td class="num">' . (int) $v[0] . '</td><td class="num">' . (int) $v[1] . '</td></tr>';
    }
    echo '</tbody></table></details>';
}

function page_analytics(int $range): void
{
    global $self;
    $a = analytics_range($range);
    $g = $a['game'];
    $views = (int) $a['views'];
    page_head('Site analytics');
    page_top('analytics');
    ?>
<nav class="filters" aria-label="Date range">
  <?php foreach (array(1 => 'Today', 7 => 'Last 7 days', 30 => 'Last 30 days', 90 => 'Last 90 days') as $r => $label): ?>
    <a href="<?= h($self) ?>?view=analytics&amp;range=<?= $r ?>" <?= $r === $range ? 'aria-current="true"' : '' ?>><?= h($label) ?></a>
  <?php endforeach; ?>
</nav>

<section class="kpis">
  <div class="kpi"><span>Visitors</span><b><?= number_format((int) $a['visitors']) ?></b></div>
  <div class="kpi"><span>Page views</span><b><?= number_format($views) ?></b></div>
  <div class="kpi"><span>Average time on the site</span><b><?= $views ? h(dur((float) $a['time'] / $views)) : '0 s' ?></b></div>
  <div class="kpi"><span>Games played</span><b><?= number_format((int) $g['starts']) ?></b></div>
  <div class="kpi"><span>Finished but not saved</span><b><?= number_format(max(0, (int) $g['runs'] - (int) $g['saved'])) ?></b><em><?= (int) $g['runs'] ? pct(max(0, (int) $g['runs'] - (int) $g['saved']), (int) $g['runs']) . ' of finished games' : 'no finished games yet' ?></em></div>
  <div class="kpi"><span>Scores saved</span><b><?= number_format((int) $g['saved']) ?></b></div>
</section>

<?php if ($range > 1): ?>
<section class="panel">
  <h2>Visitors per day</h2>
  <?php column_chart($a['series']); ?>
</section>
<?php endif; ?>

<?php if (!$views && !(int) $g['starts']): ?>
  <p class="notice">No visits counted for this period yet. Counting started with this update, so give it a day of visitors.</p>
<?php endif; ?>

<div class="grid">
  <section class="panel">
    <h2>Where people spend their time</h2>
    <p class="hint">Time each part of the page was on screen, and the share of visits that reached it.</p>
    <?php
    $rows = array();
    $secs = $a['sec'];
    uasort($secs, function ($x, $y) { return $y[0] <=> $x[0]; });
    foreach ($secs as $name => $p) {
        $rows[] = array($name, $p[0], dur((float) $p[0]) . ' · ' . pct((int) $p[1], $views));
    }
    bars($rows, 'Nothing yet.', 20);
    ?>
  </section>

  <section class="panel">
    <h2>Projects people look at</h2>
    <p class="hint">Time each project and app was on screen.</p>
    <?php
    $rows = array();
    $items = $a['item'];
    uasort($items, function ($x, $y) { return $y[0] <=> $x[0]; });
    foreach ($items as $name => $p) {
        $rows[] = array($name, $p[0], dur((float) $p[0]) . ' · ' . (int) $p[1] . ' visit' . ((int) $p[1] === 1 ? '' : 's'));
    }
    bars($rows, 'Nothing yet.', 20);
    ?>
  </section>

  <section class="panel">
    <h2>What gets clicked</h2>
    <p class="hint">Links and buttons, with the part of the page they are in.</p>
    <?php bars(sorted_counts($a['click']), 'No clicks yet.', 15, true); ?>
  </section>

  <section class="panel">
    <h2>How far down people scroll</h2>
    <p class="hint">Share of visits that reached each point of the page.</p>
    <?php
    $rows = array();
    foreach (array('25' => 'A quarter of the page', '50' => 'Halfway', '75' => 'Three quarters', '100' => 'The bottom') as $q => $label) {
        $rows[] = array($label, (int) $a['depth'][$q], pct((int) $a['depth'][$q], $views));
    }
    if (!$views) {
        $rows = array();
    }
    bars($rows, 'Nothing yet.');
    ?>
  </section>

  <section class="panel">
    <h2>The game</h2>
    <p class="hint">From pressing Play to saving a score.</p>
    <?php
    $starts = (int) $g['starts']; $runs = (int) $g['runs']; $saved = (int) $g['saved'];
    $rows = $starts ? array(
        array('Pressed Play', $starts, number_format($starts)),
        array('Finished a run', $runs, number_format($runs) . ' · ' . pct($runs, $starts)),
        array('Saved their score', $saved, number_format($saved) . ' · ' . pct($saved, max(1, $runs)) . ' of finished'),
    ) : array();
    bars($rows, 'No games yet.');
    if ($starts): ?>
      <dl class="facts">
        <div><dt>Left in the middle of a run</dt><dd><?= number_format(max(0, $starts - $runs)) ?></dd></div>
        <div><dt>Average run</dt><dd><?= $runs ? h(dur((float) $g['secs'] / $runs)) : '–' ?></dd></div>
        <div><dt>Best score</dt><dd><?= number_format((int) $g['best']) ?></dd></div>
      </dl>
    <?php endif; ?>
  </section>

  <section class="panel">
    <h2>Scores</h2>
    <p class="hint">Finished runs by score.</p>
    <?php
    $rows = array();
    foreach (array('Under 250', '250 to 499', '500 to 999', '1,000 to 1,999', '2,000 to 4,999', '5,000 and up') as $band) {
        $n = (int) ($g['score'][$band] ?? 0);
        $rows[] = array($band, $n, number_format($n));
    }
    bars($runs ? $rows : array(), 'No finished games yet.');
    ?>
  </section>

  <section class="panel">
    <h2>What ends runs</h2>
    <?php
    $names = array('hole' => 'Potholes', 'manhole' => 'Open manholes', 'goat' => 'Goats', 'goats' => 'Two goats', 'snowman' => 'Snowmen', 'car' => 'Oncoming cars', 'van' => 'Vans', 'truck' => 'Pickup trucks', 'other' => 'Other');
    $rows = array();
    foreach (sorted_counts((array) $g['kind']) as $r) {
        $rows[] = array($names[$r[0]] ?? $r[0], $r[1], $r[2]);
    }
    bars($rows, 'No finished games yet.');
    ?>
  </section>

  <section class="panel">
    <h2>Where runs end</h2>
    <p class="hint">The village each finished run ended in.</p>
    <?php bars(sorted_counts((array) $g['reach']), 'No finished games yet.'); ?>
  </section>

  <section class="panel">
    <h2>Where visitors come from</h2>
    <p class="hint">The site that sent them. WhatsApp and most apps don't say, so they count as direct.</p>
    <?php bars(sorted_counts($a['ref']), 'Nothing yet.', 12, true); ?>
    <?php if ($a['utm']): ?>
      <h3>Campaign links</h3>
      <p class="hint">Links you shared with utm_source, utm_medium and utm_campaign.</p>
      <?php bars(sorted_counts($a['utm']), '', 12, true); ?>
    <?php endif; ?>
  </section>

  <section class="panel">
    <h2>Devices</h2>
    <?php bars(sorted_counts($a['dev']), 'Nothing yet.'); ?>
    <h3>Time zones</h3>
    <p class="hint">A rough guide to where visitors are.</p>
    <?php
    $rows = array();
    foreach (sorted_counts($a['tz']) as $r) {
        $rows[] = array(tz_label((string) $r[0]), $r[1], $r[2]);
    }
    bars($rows, 'Nothing yet.', 8);
    ?>
  </section>
</div>

<p class="foot">Counted without cookies. Visitors are anonymous and told apart for one day only; no IP addresses are kept. Browsers that ask not to be tracked are not counted. Times are Beirut time.</p>
<script>
  (function () {
    var tip = document.querySelector('.chart .tip'), fig = document.querySelector('.chart');
    if (!tip || !fig) return;
    function show(g) {
      var r = g.getBoundingClientRect(), f = fig.getBoundingClientRect();
      tip.textContent = g.getAttribute('data-tip');
      tip.hidden = false;
      var x = r.left - f.left + r.width / 2;
      tip.style.left = Math.max(70, Math.min(f.width - 70, x)) + 'px';
      g.classList.add('on');
    }
    function hide(g) { tip.hidden = true; g.classList.remove('on'); }
    document.querySelectorAll('.chart .col').forEach(function (g) {
      g.addEventListener('pointerenter', function () { show(g); });
      g.addEventListener('pointerleave', function () { hide(g); });
      g.addEventListener('focus', function () { show(g); });
      g.addEventListener('blur', function () { hide(g); });
    });
  })();
</script>
<?php
    page_foot();
}

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
  .tabs, .filters { display: flex; flex-wrap: wrap; gap: 6px; }
  .tabs a, .filters a { padding: 8px 14px; border-radius: 999px; color: var(--dim); text-decoration: none; font-weight: 600; font-size: .9rem; box-shadow: inset 0 0 0 1px var(--line); }
  .tabs a[aria-current], .filters a[aria-current] { background: var(--cream); color: #10241B; box-shadow: none; }
  .filters a { padding: 6px 12px; font-size: .85rem; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
  .kpi { padding: 14px 16px; border-radius: 12px; background: var(--panel); border: 1px solid var(--line); display: grid; gap: 4px; align-content: start; }
  .kpi span { color: var(--dim); font-size: .85rem; }
  .kpi b { font-size: 1.8rem; line-height: 1.1; font-weight: 650; }
  .kpi em { font-style: normal; color: var(--dim); font-size: .8rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 14px; }
  .panel { padding: 18px; border-radius: 14px; background: var(--panel); border: 1px solid var(--line); min-width: 0; }
  .panel h2 { margin: 0 0 4px; font-size: 1.05rem; }
  .panel h3 { margin: 18px 0 8px; font-size: .95rem; }
  .hint { margin: 0 0 12px; color: var(--dim); font-size: .82rem; }
  .bars { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .bars li { display: grid; grid-template-columns: minmax(90px, 38%) minmax(0, 1fr) auto; align-items: center; gap: 10px; font-size: .88rem; }
  .bl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; unicode-bidi: plaintext; }
  .bars.long li { grid-template-columns: minmax(0, 1fr) auto; row-gap: 4px; }
  .bars.long .bl { grid-column: 1 / -1; white-space: normal; }
  .bt { height: 12px; }
  .bt i { display: block; height: 12px; background: #E8622A; border-radius: 0 4px 4px 0; }
  .bv { color: var(--dim); font-variant-numeric: tabular-nums; white-space: nowrap; font-size: .82rem; }
  .facts { margin: 14px 0 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .facts div { padding: 10px; border-radius: 10px; background: rgba(255,250,230,.05); }
  .facts dt { color: var(--dim); font-size: .78rem; }
  .facts dd { margin: 2px 0 0; font-weight: 650; }
  .chart { position: relative; margin: 8px 0 0; }
  .chart svg { display: block; width: 100%; height: auto; overflow: visible; }
  .chart .grid { stroke: rgba(255,250,230,.1); stroke-width: 1; }
  .chart .base { stroke: rgba(255,250,230,.3); stroke-width: 1; }
  .chart-scroll { overflow-x: auto; }
  .chart .tick { fill: var(--dim); font-size: 12px; font-family: system-ui, sans-serif; }
  .chart .bar { fill: #E8622A; }
  .chart .hit { fill: transparent; }
  .chart .col { outline: none; cursor: default; }
  .chart .col.on .bar, .chart .col:focus .bar { fill: #F2804F; }
  .chart .col.on .hit, .chart .col:focus .hit { fill: rgba(255,250,230,.05); }
  .chart .tip { position: absolute; top: -6px; transform: translate(-50%, -100%); padding: 6px 10px; border-radius: 8px; background: var(--cream); color: #10241B; font-size: .8rem; font-weight: 600; white-space: nowrap; pointer-events: none; }
  .tableview { margin-top: 10px; color: var(--dim); font-size: .85rem; }
  .tableview summary { cursor: pointer; }
  .tableview table { min-width: 0; margin-top: 8px; }
  .tableview td, .tableview th { padding: 6px 10px; }
  @media (max-width: 560px) { .grid { grid-template-columns: minmax(0, 1fr); } .facts { grid-template-columns: minmax(0, 1fr); } .bars li { grid-template-columns: minmax(80px, 40%) minmax(0, 1fr) auto; } }
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
    page_head('pixelabs.tech admin');
    ?>
<form class="login" method="post" autocomplete="on">
  <div>
    <p class="kicker">pixelabs.tech</p>
    <h1>Admin</h1>
  </div>
  <label for="key">Password</label>
  <input id="key" name="key" type="password" autocomplete="current-password" required autofocus>
  <?php if ($error !== ''): ?><p class="err"><?= h($error) ?></p><?php endif; ?>
  <button class="btn" name="login" value="1">Sign in</button>
</form>
<?php
    page_foot();
}
