// Text made safe to draw and to send: plain functions on strings. Pure: it
// never touches Claude Code.

/**
 * Text with every control character but tab and newline taken out: terminal
 * escape sequences whole, then any other C0 or C1 character (`\r` too). A
 * Text or Markdown holding one is refused, and the whole tree with it.
 */
export function printable(text: string): string {
  return (
    text
      // CSI sequences (colors, cursor moves), OSC sequences (titles, links), then lone escapes
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)?/g, '')
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
  )
}

/**
 * Text with each lone surrogate half (one without its pair) as U+FFFD, so
 * it can be URI-encoded: `encodeURIComponent` throws on a lone half.
 */
export function wellFormed(text: string): string {
  return text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd')
}
