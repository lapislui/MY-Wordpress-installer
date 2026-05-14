<?php
declare(strict_types=1);

$rootDir = 'C:\\Users\\Keval\\Saved Games\\xampp\\htdocs';
$rootUrl = 'http://localhost';

$ignoreExact = [
    '.',
    '..',
    '.git',
    '.vscode',
    'node_modules',
    'vendor',
    'wp-admin',
    'wp-includes',
];

$ignoreContains = [
    'backup',
    'cache',
    'copy',
    'logs',
    'old',
    'tmp',
];

function shouldIgnore(string $name, array $ignoreExact, array $ignoreContains): bool
{
    if (in_array($name, $ignoreExact, true)) {
        return true;
    }

    $lower = strtolower($name);

    foreach ($ignoreContains as $fragment) {
        if (str_contains($lower, $fragment)) {
            return true;
        }
    }

    return false;
}

function isWordPressSite(string $dir): bool
{
    return is_dir($dir)
        && (
            file_exists($dir . DIRECTORY_SEPARATOR . 'wp-config.php')
            || file_exists($dir . DIRECTORY_SEPARATOR . 'wp-load.php')
        );
}

function discoverWordPressSites(string $rootDir, string $rootUrl, array $ignoreExact, array $ignoreContains): array
{
    $sites = [];
    $entries = @scandir($rootDir) ?: [];

    foreach ($entries as $entry) {
        if (shouldIgnore($entry, $ignoreExact, $ignoreContains)) {
            continue;
        }

        $path = $rootDir . DIRECTORY_SEPARATOR . $entry;

        if (!isWordPressSite($path)) {
            continue;
        }

        $configPath = $path . DIRECTORY_SEPARATOR . 'wp-config.php';
        $hasConfig = file_exists($configPath);
        $themeCount = count(glob($path . DIRECTORY_SEPARATOR . 'wp-content/themes/*', GLOB_ONLYDIR) ?: []);
        $pluginCount = count(glob($path . DIRECTORY_SEPARATOR . 'wp-content/plugins/*', GLOB_ONLYDIR) ?: []);
        $uploadCount = count(glob($path . DIRECTORY_SEPARATOR . 'wp-content/uploads/*', GLOB_NOSORT) ?: []);
        $modifiedAt = filemtime($path) ?: time();
        $url = rtrim($rootUrl, '/') . '/' . rawurlencode($entry) . '/';

        $sites[] = [
            'name' => $entry,
            'path' => $path,
            'url' => $url,
            'admin_url' => $url . 'wp-admin/',
            'preview_url' => $url,
            'status' => $hasConfig ? 'Configured' : 'Core only',
            'theme_count' => $themeCount,
            'plugin_count' => $pluginCount,
            'upload_count' => $uploadCount,
            'modified_at' => $modifiedAt,
        ];
    }

    usort(
        $sites,
        static fn(array $a, array $b): int => strcasecmp($a['name'], $b['name'])
    );

    return $sites;
}

$sites = discoverWordPressSites($rootDir, $rootUrl, $ignoreExact, $ignoreContains);
$siteCount = count($sites);
$configuredCount = count(array_filter($sites, static fn(array $site): bool => $site['status'] === 'Configured'));
$pluginTotal = array_sum(array_column($sites, 'plugin_count'));
$themeTotal = array_sum(array_column($sites, 'theme_count'));
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WordPress Local Sites</title>
<style>
:root {
    --bg: #f4efe7;
    --bg-accent: radial-gradient(circle at top left, rgba(214, 120, 55, 0.18), transparent 34%), radial-gradient(circle at right, rgba(27, 70, 104, 0.18), transparent 30%), linear-gradient(180deg, #f8f4ed 0%, #efe4d5 100%);
    --panel: rgba(255, 252, 247, 0.88);
    --panel-strong: #fffaf3;
    --line: rgba(72, 51, 35, 0.14);
    --text: #2f241d;
    --muted: #6d5c50;
    --brand: #a64b2a;
    --brand-dark: #7f361d;
    --accent: #1d5678;
    --success: #2f7d4d;
    --shadow: 0 22px 60px rgba(66, 41, 22, 0.12);
    --radius: 24px;
}

* {
    box-sizing: border-box;
}

html {
    scroll-behavior: smooth;
}

body {
    margin: 0;
    min-height: 100vh;
    font-family: Georgia, "Times New Roman", serif;
    color: var(--text);
    background: var(--bg);
    background-image: var(--bg-accent);
}

a {
    color: inherit;
}

.shell {
    width: min(1280px, calc(100% - 32px));
    margin: 0 auto;
    padding: 28px 0 48px;
}

.hero {
    position: relative;
    overflow: hidden;
    padding: 32px;
    border: 1px solid var(--line);
    border-radius: calc(var(--radius) + 6px);
    background: linear-gradient(135deg, rgba(255, 249, 241, 0.96), rgba(247, 236, 220, 0.92));
    box-shadow: var(--shadow);
}

.hero::after {
    content: "";
    position: absolute;
    inset: auto -80px -120px auto;
    width: 260px;
    height: 260px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(29, 86, 120, 0.16), transparent 68%);
}

.eyebrow {
    margin: 0 0 10px;
    font-size: 12px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--accent);
}

.hero h1 {
    margin: 0;
    max-width: 12ch;
    font-size: clamp(2.5rem, 6vw, 4.8rem);
    line-height: 0.95;
    letter-spacing: -0.05em;
}

.hero-copy {
    margin: 18px 0 0;
    max-width: 62ch;
    font-size: 1rem;
    line-height: 1.7;
    color: var(--muted);
}

.hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 24px;
}

.button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 12px 18px;
    border-radius: 999px;
    border: 1px solid transparent;
    text-decoration: none;
    font-weight: 700;
    transition: transform 160ms ease, background 160ms ease, border-color 160ms ease;
}

.button:hover {
    transform: translateY(-1px);
}

.button-primary {
    color: #fff8f3;
    background: linear-gradient(135deg, var(--brand), var(--brand-dark));
}

.button-secondary {
    color: var(--accent);
    background: rgba(29, 86, 120, 0.08);
    border-color: rgba(29, 86, 120, 0.15);
}

.stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
    margin-top: 22px;
}

.stat {
    padding: 18px 20px;
    border-radius: 20px;
    background: rgba(255, 250, 243, 0.84);
    border: 1px solid var(--line);
}

.stat strong {
    display: block;
    font-size: clamp(1.8rem, 3vw, 2.4rem);
    line-height: 1;
}

.stat span {
    display: block;
    margin-top: 6px;
    font-size: 0.95rem;
    color: var(--muted);
}

.toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 24px 0 18px;
}

.toolbar h2 {
    margin: 0;
    font-size: 1.4rem;
}

.search {
    width: min(360px, 100%);
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: rgba(255, 252, 247, 0.9);
    color: var(--text);
    font: inherit;
}

.search:focus {
    outline: 2px solid rgba(29, 86, 120, 0.2);
    outline-offset: 1px;
}

.grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 20px;
}

.card {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 420px;
    border-radius: var(--radius);
    border: 1px solid var(--line);
    background: var(--panel);
    box-shadow: var(--shadow);
    backdrop-filter: blur(8px);
}

.preview {
    position: relative;
    aspect-ratio: 16 / 10;
    border-bottom: 1px solid var(--line);
    background: linear-gradient(180deg, rgba(47, 36, 29, 0.08), rgba(47, 36, 29, 0.04));
}

.preview iframe {
    width: 100%;
    height: 100%;
    border: 0;
    background: #ffffff;
}

.preview-note {
    position: absolute;
    left: 14px;
    bottom: 14px;
    padding: 8px 10px;
    border-radius: 999px;
    background: rgba(255, 250, 243, 0.92);
    border: 1px solid rgba(72, 51, 35, 0.1);
    font-size: 0.8rem;
    color: var(--muted);
}

.card-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    padding: 18px;
    gap: 14px;
}

.card-top {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 12px;
}

.card h3 {
    margin: 0;
    font-size: 1.45rem;
}

.badge {
    flex-shrink: 0;
    padding: 7px 10px;
    border-radius: 999px;
    background: rgba(47, 125, 77, 0.12);
    color: var(--success);
    font-size: 0.8rem;
    font-weight: 700;
}

.meta {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
}

.meta-item {
    padding: 12px;
    border-radius: 16px;
    background: rgba(255, 250, 243, 0.9);
    border: 1px solid rgba(72, 51, 35, 0.08);
}

.meta-item strong {
    display: block;
    font-size: 1.1rem;
}

.meta-item span {
    display: block;
    margin-top: 4px;
    font-size: 0.82rem;
    color: var(--muted);
}

.path {
    padding: 12px 14px;
    border-radius: 16px;
    background: rgba(29, 86, 120, 0.06);
    color: var(--muted);
    font-size: 0.88rem;
    line-height: 1.5;
    word-break: break-word;
}

.card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: auto;
}

.card-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 11px 14px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--panel-strong);
    text-decoration: none;
    font-weight: 700;
}

.card-link.primary {
    color: #fff8f3;
    border-color: transparent;
    background: linear-gradient(135deg, var(--accent), #153c54);
}

.empty {
    padding: 32px;
    border-radius: var(--radius);
    border: 1px solid var(--line);
    background: rgba(255, 252, 247, 0.86);
    box-shadow: var(--shadow);
    text-align: center;
}

.empty strong {
    display: block;
    margin-bottom: 8px;
    font-size: 1.25rem;
}

.muted {
    color: var(--muted);
}

.footer {
    margin-top: 26px;
    color: var(--muted);
    font-size: 0.9rem;
    text-align: center;
}

@media (max-width: 900px) {
    .stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }
}

@media (max-width: 640px) {
    .shell {
        width: min(100% - 20px, 1280px);
        padding-top: 18px;
    }

    .hero {
        padding: 22px;
    }

    .stats,
    .meta {
        grid-template-columns: 1fr;
    }

    .toolbar {
        align-items: stretch;
    }

    .search {
        width: 100%;
    }
}
</style>
</head>
<body>
<main class="shell">
    <section class="hero">
        <p class="eyebrow">Local xampp dashboard</p>
        <h1>WordPress sites in htdocs</h1>
        <p class="hero-copy">
            A single page for browsing every WordPress install under your local <code>htdocs</code>.
            Each card includes a live preview, quick admin access, and a few useful file-level stats.
        </p>
        <div class="hero-actions">
            <a class="button button-primary" href="#sites">Browse sites</a>
            <a class="button button-secondary" href="http://localhost/" target="_blank" rel="noreferrer">Open localhost root</a>
        </div>
        <div class="stats">
            <div class="stat">
                <strong><?= $siteCount ?></strong>
                <span>WordPress installs</span>
            </div>
            <div class="stat">
                <strong><?= $configuredCount ?></strong>
                <span>Configured sites</span>
            </div>
            <div class="stat">
                <strong><?= $pluginTotal ?></strong>
                <span>Total plugin folders</span>
            </div>
            <div class="stat">
                <strong><?= $themeTotal ?></strong>
                <span>Total theme folders</span>
            </div>
        </div>
    </section>

    <section id="sites">
        <div class="toolbar">
            <h2>Site previews</h2>
            <input id="siteSearch" class="search" type="search" placeholder="Filter by folder name..." autocomplete="off">
        </div>

        <?php if ($siteCount === 0): ?>
            <div class="empty">
                <strong>No WordPress installs found.</strong>
                <span class="muted">This page looks for top-level folders in <code>htdocs</code> that contain <code>wp-config.php</code> or <code>wp-load.php</code>.</span>
            </div>
        <?php else: ?>
            <div class="grid" id="siteGrid">
                <?php foreach ($sites as $site): ?>
                    <article class="card" data-site-name="<?= htmlspecialchars(strtolower($site['name']), ENT_QUOTES) ?>">
                        <div class="preview">
                            <iframe loading="lazy" src="<?= htmlspecialchars($site['preview_url']) ?>" title="<?= htmlspecialchars($site['name']) ?> preview"></iframe>
                            <div class="preview-note">Live preview</div>
                        </div>
                        <div class="card-body">
                            <div class="card-top">
                                <div>
                                    <h3><?= htmlspecialchars($site['name']) ?></h3>
                                    <div class="muted">Updated <?= htmlspecialchars(date('d M Y, h:i A', $site['modified_at'])) ?></div>
                                </div>
                                <span class="badge"><?= htmlspecialchars($site['status']) ?></span>
                            </div>

                            <div class="meta">
                                <div class="meta-item">
                                    <strong><?= $site['theme_count'] ?></strong>
                                    <span>Themes</span>
                                </div>
                                <div class="meta-item">
                                    <strong><?= $site['plugin_count'] ?></strong>
                                    <span>Plugins</span>
                                </div>
                                <div class="meta-item">
                                    <strong><?= $site['upload_count'] ?></strong>
                                    <span>Upload entries</span>
                                </div>
                            </div>

                            <div class="path"><?= htmlspecialchars($site['path']) ?></div>

                            <div class="card-actions">
                                <a class="card-link primary" href="<?= htmlspecialchars($site['url']) ?>" target="_blank" rel="noreferrer">Open site</a>
                                <a class="card-link" href="<?= htmlspecialchars($site['admin_url']) ?>" target="_blank" rel="noreferrer">WP Admin</a>
                                <a class="card-link" href="<?= htmlspecialchars($site['preview_url']) ?>" target="_blank" rel="noreferrer">Open preview</a>
                            </div>
                        </div>
                    </article>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>
    </section>

    <p class="footer">Generated from <?= htmlspecialchars($rootDir) ?> using local file detection.</p>
</main>

<script>
const searchInput = document.getElementById('siteSearch');
const siteCards = Array.from(document.querySelectorAll('[data-site-name]'));

if (searchInput) {
    searchInput.addEventListener('input', function () {
        const query = this.value.trim().toLowerCase();

        siteCards.forEach(function (card) {
            const name = card.getAttribute('data-site-name') || '';
            card.style.display = name.includes(query) ? '' : 'none';
        });
    });
}
</script>
</body>
</html>
