// Split file/stdout text into non-empty lines, tolerating CRLF checkouts.
// Golden vectors and manifests are committed LF but read back CRLF on Windows
// (no .gitattributes); a bare split("\n") leaves a trailing \r that fails
// hex/UUID validation.
export function readLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}
