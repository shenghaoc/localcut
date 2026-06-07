/**
 * Lightweight markdown-to-HTML renderer — no external dependencies.
 * Handles the subset of CommonMark used in LocalCut Studio documentation:
 * headings (h1-h3), paragraphs, bold, italic, inline code, fenced code blocks,
 * unordered/ordered lists, links, horizontal rules, and tables.
 *
 * Security: escapes raw HTML in source text before processing. Sanitizes
 * link URLs to prevent javascript: and data: protocol injection.
 */
export function renderMarkdown(source: string): string {
  const lines = source.split('\n');
  const html: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      html.push(`<pre><code class="${lang ? `language-${lang}` : ''}">`);
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        html.push(escapeHtml(lines[i]!));
        i++;
      }
      html.push('</code></pre>');
      i++; // skip closing ```
      continue;
    }

    // Table — header row followed by a separator row
    if (
      i + 1 < lines.length &&
      /^\|.+\|$/.test(line) &&
      /^\|[-:\s|]+\|$/.test(lines[i + 1]!)
    ) {
      const headerCells = line.split('|').slice(1, -1).map((c) => c.trim());
      const alignments = lines[i + 1]!
        .split('|')
        .slice(1, -1)
        .map((c) => {
          const trimmed = c.trim();
          if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
          if (trimmed.endsWith(':')) return 'right';
          return 'left';
        });
      html.push('<table><thead><tr>');
      for (let ci = 0; ci < headerCells.length; ci++) {
        html.push(
          `<th style="text-align:${alignments[ci] ?? 'left'}">${renderInline(headerCells[ci]!)}</th>`,
        );
      }
      html.push('</tr></thead><tbody>');
      i += 2;
      while (i < lines.length && /^\|.+\|$/.test(lines[i]!)) {
        const cells = lines[i]!
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());
        html.push('<tr>');
        for (let ci = 0; ci < cells.length; ci++) {
          html.push(
            `<td style="text-align:${alignments[ci] ?? 'left'}">${renderInline(cells[ci]!)}</td>`,
          );
        }
        html.push('</tr>');
        i++;
      }
      html.push('</tbody></table>');
      continue;
    }

    // Horizontal rule
    if (/^(---|\*\*\*|___)\s*$/.test(line)) {
      html.push('<hr />');
      i++;
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const text = headingMatch[2]!;
      html.push(`<h${level}>${renderInline(text)}</h${level}>`);
      i++;
      continue;
    }

    // Unordered list
    if (/^[\-\*\+]\s+/.test(line)) {
      html.push('<ul>');
      while (i < lines.length && /^[\-\*\+]\s+/.test(lines[i]!)) {
        const content = lines[i]!.replace(/^[\-\*\+]\s+/, '');
        html.push(`<li>${renderInline(content)}</li>`);
        i++;
      }
      html.push('</ul>');
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      html.push('<ol>');
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!)) {
        const content = lines[i]!.replace(/^\d+\.\s+/, '');
        html.push(`<li>${renderInline(content)}</li>`);
        i++;
      }
      html.push('</ol>');
      continue;
    }

    // Blank line
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty, non-special lines
    const paragraphLines: string[] = [];
    while (i < lines.length && !isSpecialLine(lines[i]!)) {
      paragraphLines.push(lines[i]!);
      i++;
    }
    if (paragraphLines.length > 0) {
      html.push(`<p>${renderInline(paragraphLines.join(' '))}</p>`);
    }
  }

  return html.join('\n');
}

function isSpecialLine(line: string): boolean {
  return (
    /^\s*$/.test(line) ||
    /^```/.test(line) ||
    /^(#{1,3})\s+/.test(line) ||
    /^[\-\*\+]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    /^(---|\*\*\*|___)\s*$/.test(line) ||
    /^\|.+\|$/.test(line)
  );
}

function renderInline(text: string): string {
  let out = escapeHtml(text);

  // Extract inline code spans into placeholders so their content
  // is protected from bold/italic/link processing.
  const codePlaceholders: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_full, code: string) => {
    codePlaceholders.push(`<code>${code}</code>`);
    return `\x00C${codePlaceholders.length - 1}\x00`;
  });

  // Bold + Italic (***)
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');

  // Bold (**)
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic (*) — single asterisk, not part of ** or ***
  out = out.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

  // Links [text](url) — sanitize URL to prevent XSS
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_full, linkText: string, url: string) => {
    const safeUrl = isSafeUrl(url.trim()) ? url : '#';
    return `<a href="${safeUrl}" target="_blank" rel="noopener">${linkText}</a>`;
  });

  // Restore code span placeholders
  out = out.replace(/\x00C(\d+)\x00/g, (_full, idx: string) => codePlaceholders[Number(idx)] ?? '');

  return out;
}

function isSafeUrl(url: string): boolean {
  return /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(url);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
