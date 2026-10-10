import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Maintenance tool for the patched PrismarineJS forks this bot depends on. `forks/forks.json` is
 * the single source of truth for which fixes each fork carries and which upstream PR tracks each
 * one; see docs/forks.md for the workflow.
 *
 * Each fork's integration branch is *rebuilt* from upstream + the listed fixes rather than edited
 * by hand, so dropping a fix once upstream merges it is just deleting its manifest entry.
 */

interface Fix {
  /** A branch on the fork (merged), or… */
  branch?: string;
  /** …a single commit to cherry-pick, for a fix that has no branch/PR of its own yet. */
  pick?: string;
  pr: number | null;
  why: string;
}

interface Repo {
  fork: string;
  upstream: string;
  /** Directory name under FORKS_DIR. */
  checkout: string;
  /**
   * What the integration branch is built on: an upstream branch name, or a pinned upstream commit
   * when the fork deliberately trails upstream (moving it forward is a tested release of its own).
   */
  base: string;
  /** The upstream branch `status` measures "behind" against. */
  track: string;
  fixes: Fix[];
}

interface Package extends Repo {
  pinned: string | null;
  /** Shell steps to run in a fresh clone before publishing (minecraft-data generates its data). */
  build?: string[];
  /** minecraft-data only: the data repo the npm wrapper embeds as a submodule. */
  data?: Repo;
}

interface Manifest {
  scope: string | null;
  integrationBranch: string;
  packages: Record<string, Package>;
}

const FORKS_DIR = process.env.FORKS_DIR ?? path.join(homedir(), 'Developer');
const manifest = JSON.parse(readFileSync('forks/forks.json', 'utf8')) as Manifest;

function run(cmd: string, args: string[], cwd?: string): { ok: boolean; out: string } {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

function git(repo: Repo, ...args: string[]): { ok: boolean; out: string } {
  return run('git', args, path.join(FORKS_DIR, repo.checkout));
}

/** Every repo in the manifest, including minecraft-data's nested data repo. */
function repos(only?: string): { label: string; repo: Repo }[] {
  const selected = Object.entries(manifest.packages).filter(([name]) => !only || name === only);
  if (only && selected.length === 0) {
    throw new Error(
      `Unknown package "${only}". Known: ${Object.keys(manifest.packages).join(', ')}`,
    );
  }
  const result: { label: string; repo: Repo }[] = [];
  for (const [name, pkg] of selected) {
    if (pkg.data) result.push({ label: `${name} (data)`, repo: pkg.data });
    result.push({ label: name, repo: pkg });
  }
  return result;
}

function baseRef(repo: Repo): string {
  return /^[0-9a-f]{7,40}$/.test(repo.base) ? repo.base : `upstream/${repo.base}`;
}

function prState(repo: Repo, pr: number): string {
  const result = run('gh', [
    'pr',
    'view',
    String(pr),
    '-R',
    repo.upstream,
    '--json',
    'state',
    '--jq',
    '.state',
  ]);
  return result.ok ? result.out : 'UNKNOWN';
}

function status(only?: string): void {
  for (const { label, repo } of repos(only)) {
    const dir = path.join(FORKS_DIR, repo.checkout);
    if (!existsSync(dir)) {
      console.log(`\n${label}: no checkout at ${dir}`);
      continue;
    }
    git(repo, 'fetch', '-q', 'upstream');
    const integration = manifest.integrationBranch;
    const built = git(repo, 'rev-parse', '-q', '--verify', integration).ok;
    const behind = built
      ? git(repo, 'rev-list', '--count', `${integration}..upstream/${repo.track}`).out
      : '-';
    const pinned = 'pinned' in repo ? ((repo as Package).pinned ?? 'not published') : 'n/a';
    console.log(
      `\n${label}  [${repo.fork}]\n  pinned: ${pinned}   ${integration}: ${built ? `${behind} behind upstream/${repo.track}` : 'not built'}   base: ${repo.base}`,
    );
    for (const fix of repo.fixes) {
      const state = fix.pr ? prState(repo, fix.pr) : 'NO PR';
      const flag = state === 'MERGED' ? '  <- merged upstream: drop this entry' : '';
      const ref = fix.branch ?? `pick ${fix.pick}`;
      console.log(
        `  ${state.padEnd(7)} ${fix.pr ? `#${fix.pr}` : '-'}  ${ref}${flag}\n          ${fix.why}`,
      );
    }
  }
}

/**
 * Recreates the integration branch as <base> + every fix, in a throwaway worktree so the
 * fork's own checkout (and whatever branch is checked out there) is never touched. The branch
 * pointer only moves once every fix has applied cleanly.
 */
function rebuild(only: string, compareTo?: string): void {
  for (const { label, repo } of repos(only)) {
    const data = 'data' in repo ? (repo as Package).data : undefined;
    git(repo, 'fetch', '-q', 'upstream');
    // Fetch each fix branch by name: some checkouts carry a narrowed `origin` fetch refspec, so a
    // plain `git fetch origin` wouldn't necessarily create `origin/<branch>`.
    for (const fix of repo.fixes) {
      if (!fix.branch) continue;
      const ref = `+refs/heads/${fix.branch}:refs/remotes/origin/${fix.branch}`;
      const fetched = git(repo, 'fetch', '-q', 'origin', ref);
      if (!fetched.ok) throw new Error(`${label}: could not fetch ${fix.branch}:\n${fetched.out}`);
    }
    const worktree = mkdtempSync(path.join(tmpdir(), 'squinch-rebuild-'));
    try {
      const add = git(repo, 'worktree', 'add', '-q', '--detach', worktree, baseRef(repo));
      if (!add.ok) throw new Error(add.out);
      for (const fix of repo.fixes) {
        const step = fix.branch
          ? run('git', ['merge', '-q', '--no-ff', '--no-edit', `origin/${fix.branch}`], worktree)
          : run('git', ['cherry-pick', fix.pick!], worktree);
        if (!step.ok) {
          throw new Error(
            `${label}: ${fix.branch ?? fix.pick} did not apply cleanly:\n${step.out}`,
          );
        }
      }
      if (data) pinDataSubmodule(data, worktree);
      const head = run('git', ['rev-parse', 'HEAD'], worktree).out;
      git(repo, 'branch', '-f', manifest.integrationBranch, head);
      console.log(
        `${label}: ${manifest.integrationBranch} -> ${head.slice(0, 9)} (${repo.fixes.length} fixes)`,
      );
      if (compareTo) {
        const diff = git(repo, 'diff', '--stat', compareTo, manifest.integrationBranch);
        console.log(
          diff.out
            ? `  differs from ${compareTo}:\n${diff.out}`
            : `  identical tree to ${compareTo}`,
        );
      }
    } finally {
      git(repo, 'worktree', 'remove', '--force', worktree);
      rmSync(worktree, { recursive: true, force: true });
    }
  }
}

/**
 * The minecraft-data npm package is a thin wrapper that embeds the data repo as a git submodule.
 * Point that submodule at our data fork's integration branch (rebuilt just before this, since
 * `repos()` orders a package's data repo ahead of it) so publishing never involves copying files
 * between checkouts by hand.
 */
function pinDataSubmodule(data: Repo, worktree: string): void {
  const sha = git(data, 'rev-parse', manifest.integrationBranch).out;
  const steps: string[][] = [
    [
      'config',
      '-f',
      '.gitmodules',
      'submodule.minecraft-data.url',
      `https://github.com/${data.fork}.git`,
    ],
    ['update-index', '--cacheinfo', `160000,${sha},minecraft-data`],
    ['add', '.gitmodules'],
    ['commit', '-q', '-m', `Pin minecraft-data submodule to ${data.fork}@${sha.slice(0, 9)}`],
  ];
  for (const args of steps) {
    const step = run('git', args, worktree);
    if (!step.ok)
      throw new Error(`pinning the data submodule failed (git ${args[0]}):\n${step.out}`);
  }
}

function sh(command: string, cwd: string): string {
  const result = spawnSync(command, { cwd, shell: true, encoding: 'utf8' });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status !== 0) throw new Error(`\`${command}\` failed:\n${out}`);
  return out;
}

/** Next `<upstream version>-squinch.<n>` not yet on the registry. */
function nextVersion(npmName: string, upstreamVersion: string): string {
  const view = run('npm', ['view', npmName, 'versions', '--json']);
  const published: string[] = view.ok ? [JSON.parse(view.out) as string | string[]].flat() : [];
  const prefix = `${upstreamVersion}-squinch.`;
  const taken = published
    .filter((v) => v.startsWith(prefix))
    .map((v) => Number(v.slice(prefix.length)));
  return `${prefix}${Math.max(0, ...taken) + 1}`;
}

/**
 * Publishes a fork's integration branch as `<scope>/<package>` and pins the bot to it.
 *
 * Always builds from a fresh clone of the fork on GitHub, never from the local checkout, so what
 * lands on npm is reproducible from public git and can't pick up stray local files. The package is
 * renamed here rather than in the fork, which keeps the fork's branches identical to what upstream
 * reviews.
 */
function publish(name: string, dryRun: boolean): void {
  const pkg = manifest.packages[name];
  if (!pkg) throw new Error(`Unknown package "${name}"`);
  if (!manifest.scope) throw new Error('Set "scope" in forks/forks.json first');
  const branch = manifest.integrationBranch;
  const repoUrl = `https://github.com/${pkg.fork}.git`;
  const local = git(pkg, 'rev-parse', branch).out;
  const remote = run('git', ['ls-remote', repoUrl, `refs/heads/${branch}`]).out.split(/\s/)[0];
  if (local !== remote) {
    throw new Error(
      `${name}: ${branch} is not pushed to ${pkg.fork} (local ${local.slice(0, 9)}, remote ${remote?.slice(0, 9) || 'missing'})`,
    );
  }

  const dir = mkdtempSync(path.join(tmpdir(), 'squinch-publish-'));
  try {
    sh(
      `git clone -q --depth 1 --branch ${branch} --recurse-submodules --shallow-submodules ${repoUrl} .`,
      dir,
    );
    for (const step of pkg.build ?? []) sh(step, dir);

    const npmName = `${manifest.scope}/${name}`;
    const upstreamVersion = (
      JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version: string }
    ).version;
    const version = nextVersion(npmName, upstreamVersion);
    sh(
      `npm pkg set name=${npmName} version=${version} repository.type=git repository.url=git+${repoUrl}`,
      dir,
    );
    console.log(sh(`npm publish --access public --tag latest${dryRun ? ' --dry-run' : ''}`, dir));
    if (dryRun) {
      console.log(`${name}: dry run only, would publish ${npmName}@${version}`);
      return;
    }

    const tag = `${branch}-v${version}`;
    git(pkg, 'tag', tag, local);
    git(pkg, 'push', '-q', 'origin', tag);

    pkg.pinned = version;
    writeFileSync('forks/forks.json', `${JSON.stringify(manifest, null, 2)}\n`);
    const botPkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
      overrides: Record<string, string>;
    };
    botPkg.dependencies[name] = botPkg.overrides[name] = `npm:${npmName}@${version}`;
    writeFileSync('package.json', `${JSON.stringify(botPkg, null, 2)}\n`);
    console.log(`${name}: published ${npmName}@${version}, tagged ${tag}, pinned in package.json`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const [command, ...rest] = process.argv.slice(2);
const target = rest.find((arg) => !arg.startsWith('--'));
const compareTo = rest.find((arg) => arg.startsWith('--compare='))?.slice('--compare='.length);

try {
  if (command === 'status') status(target);
  else if (command === 'rebuild' && target) rebuild(target, compareTo);
  else if (command === 'publish' && target) publish(target, rest.includes('--dry-run'));
  else {
    console.log(
      'Usage:\n  bun run forks status [package]\n  bun run forks rebuild <package> [--compare=<ref>]\n  bun run forks publish <package> [--dry-run]',
    );
    process.exit(command ? 1 : 0);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
