// Fallback module "picocolors"
// API- and output-compatible with https://github.com/alexeyraspopov/picocolors 1.x
// ISC License, Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov

type Formatter = (input: unknown) => string;

const argv: string[] = process.argv || [];
const env = process.env || {};

const isColorSupported =
  !(!!env.NO_COLOR || argv.includes("--no-color")) &&
  (!!env.FORCE_COLOR ||
    argv.includes("--color") ||
    process.platform === "win32" ||
    (!!(process.stdout || {}).isTTY && env.TERM !== "dumb") ||
    !!env.CI);

function replaceClose(string: string, close: string, replace: string, index: number): string {
  let result = "";
  let cursor = 0;
  do {
    result += string.substring(cursor, index) + replace;
    cursor = index + close.length;
    index = string.indexOf(close, cursor);
  } while (~index);
  return result + string.substring(cursor);
}

function formatter(open: string, close: string, replace: string = open): Formatter {
  return input => {
    const string = "" + input;
    const index = string.indexOf(close, open.length);
    return ~index ? open + replaceClose(string, close, replace, index) + close : open + string + close;
  };
}

function plain(_open: string, _close: string, _replace?: string): Formatter {
  return String;
}

function createColors(enabled: boolean = isColorSupported) {
  const f = enabled ? formatter : plain;
  return {
    isColorSupported: enabled,
    reset: f("\x1b[0m", "\x1b[0m"),
    bold: f("\x1b[1m", "\x1b[22m", "\x1b[22m\x1b[1m"),
    dim: f("\x1b[2m", "\x1b[22m", "\x1b[22m\x1b[2m"),
    italic: f("\x1b[3m", "\x1b[23m"),
    underline: f("\x1b[4m", "\x1b[24m"),
    inverse: f("\x1b[7m", "\x1b[27m"),
    hidden: f("\x1b[8m", "\x1b[28m"),
    strikethrough: f("\x1b[9m", "\x1b[29m"),

    black: f("\x1b[30m", "\x1b[39m"),
    red: f("\x1b[31m", "\x1b[39m"),
    green: f("\x1b[32m", "\x1b[39m"),
    yellow: f("\x1b[33m", "\x1b[39m"),
    blue: f("\x1b[34m", "\x1b[39m"),
    magenta: f("\x1b[35m", "\x1b[39m"),
    cyan: f("\x1b[36m", "\x1b[39m"),
    white: f("\x1b[37m", "\x1b[39m"),
    gray: f("\x1b[90m", "\x1b[39m"),

    bgBlack: f("\x1b[40m", "\x1b[49m"),
    bgRed: f("\x1b[41m", "\x1b[49m"),
    bgGreen: f("\x1b[42m", "\x1b[49m"),
    bgYellow: f("\x1b[43m", "\x1b[49m"),
    bgBlue: f("\x1b[44m", "\x1b[49m"),
    bgMagenta: f("\x1b[45m", "\x1b[49m"),
    bgCyan: f("\x1b[46m", "\x1b[49m"),
    bgWhite: f("\x1b[47m", "\x1b[49m"),

    blackBright: f("\x1b[90m", "\x1b[39m"),
    redBright: f("\x1b[91m", "\x1b[39m"),
    greenBright: f("\x1b[92m", "\x1b[39m"),
    yellowBright: f("\x1b[93m", "\x1b[39m"),
    blueBright: f("\x1b[94m", "\x1b[39m"),
    magentaBright: f("\x1b[95m", "\x1b[39m"),
    cyanBright: f("\x1b[96m", "\x1b[39m"),
    whiteBright: f("\x1b[97m", "\x1b[39m"),

    bgBlackBright: f("\x1b[100m", "\x1b[49m"),
    bgRedBright: f("\x1b[101m", "\x1b[49m"),
    bgGreenBright: f("\x1b[102m", "\x1b[49m"),
    bgYellowBright: f("\x1b[103m", "\x1b[49m"),
    bgBlueBright: f("\x1b[104m", "\x1b[49m"),
    bgMagentaBright: f("\x1b[105m", "\x1b[49m"),
    bgCyanBright: f("\x1b[106m", "\x1b[49m"),
    bgWhiteBright: f("\x1b[107m", "\x1b[49m"),
  };
}

const colors = Object.assign(createColors(), { createColors });
export default colors;
export const {
  isColorSupported: colorSupported,
  reset,
  bold,
  dim,
  italic,
  underline,
  inverse,
  hidden,
  strikethrough,
  black,
  red,
  green,
  yellow,
  blue,
  magenta,
  cyan,
  white,
  gray,
  bgBlack,
  bgRed,
  bgGreen,
  bgYellow,
  bgBlue,
  bgMagenta,
  bgCyan,
  bgWhite,
  blackBright,
  redBright,
  greenBright,
  yellowBright,
  blueBright,
  magentaBright,
  cyanBright,
  whiteBright,
  bgBlackBright,
  bgRedBright,
  bgGreenBright,
  bgYellowBright,
  bgBlueBright,
  bgMagentaBright,
  bgCyanBright,
  bgWhiteBright,
} = colors;
export { createColors, colorSupported as isColorSupported };
