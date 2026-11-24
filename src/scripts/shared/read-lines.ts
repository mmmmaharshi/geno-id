// Split file/stdout text into non-empty lines, tolerating CRLF checkouts.

// Golden vectors and manifests are committed LF but read back CRLF on Windows

// (no .gitattributes); a bare split("\n") leaves a trailing \r that fails

// Hex/UUID validation.

export const splitLines = (text: string): string[] =>
  text

    .split("\n")

    .map((l) => l.trim())

export const readLines = (text: string): string[] =>
  splitLines(text)

    .filter((l) => l.length > 0)
