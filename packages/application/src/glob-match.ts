const SPECIAL = ".+?^$(){}|[]\\";

const toRegExp = (pattern: string): RegExp => {
  let source = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i] as string;
    if (pattern.startsWith("**/", i)) {
      source += "(?:.*/)?";
      i += 3;
    } else if (pattern.startsWith("**", i)) {
      source += ".*";
      i += 2;
    } else if (ch === "*") {
      source += "[^/]*";
      i += 1;
    } else {
      source += SPECIAL.includes(ch) ? `\\${ch}` : ch;
      i += 1;
    }
  }
  return new RegExp("^" + source + "$", "s");
};

// Anchored, case-sensitive glob match: a single star stops at a slash; a double star plus slash is zero or more directories.
export const matchesGlob = (pattern: string, path: string): boolean => toRegExp(pattern).test(path);
