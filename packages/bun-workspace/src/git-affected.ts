/** Path-based job selection for CI: which build areas a diff touches. Package-level selection is turbo's `--affected`. */
export interface Areas {
  all: boolean;
  js: boolean;
  rust: boolean;
  docs: boolean;
  distro: boolean;
}

const GLOBAL = [/^\.github\//, /^turbo\.json$/, /^bunfig\.toml$/, /^tsconfig[^/]*\.json$/, /^rust-toolchain\.toml$/, /^\.gitmodules$/];
const RUST = [/^crates\//, /^Cargo\.(toml|lock)$/, /^\.cargo\//, /^vendor\/cargo\//, /^tools\//, /^apps\//, /^packages\/bun-tauri\//, /^scripts\/cargo/];
const JS = [/^packages\//, /^apps\//, /^src\//, /^scripts\//, /^factory\//, /^design-system\//, /^fonts\//, /^bun\.lock$/, /^package\.json$/, /^infra\//];
const DOCS = [/^docs\//, /\.mdx?$/];
const DISTRO = [/^factory\//, /^container\//, /^infra\//, /^patches\//, /^vendor\/(cachyos|linux|ogc|kernel|nvidia|open-gpu|llvm|proton|wine)/];

export function classify(files: string[]): Areas {
  const hit = (res: RegExp[]) => files.some(f => res.some(r => r.test(f)));
  const all = hit(GLOBAL);
  return { all, js: all || hit(JS), rust: all || hit(RUST), docs: all || hit(DOCS), distro: all || hit(DISTRO) };
}
