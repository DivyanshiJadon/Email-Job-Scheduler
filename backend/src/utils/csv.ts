const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/**
 * Parses raw CSV/text content and extracts a unique list of valid email
 * addresses. Handles quoted values, commas within quotes, and common
 * separators (comma, semicolon, newline, whitespace).
 */
export function extractEmailsFromText(text: string): string[] {
  const emails = new Set<string>();

  const rows = splitCsvLines(text);
  for (const row of rows) {
    const cells = parseCsvRow(row);
    for (let cell of cells) {
      // Sometimes a cell contains "Name <email>" or JSON-ish arrays.
      cell = cell.trim();
      if (!cell) continue;

      const matches = cell.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
      if (matches) {
        for (const m of matches) emails.add(m.toLowerCase());
        continue;
      }
    }
  }

  return Array.from(emails);
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

function splitCsvLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Minimal RFC4180-ish row parser: handles double-quoted fields with commas. */
export function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}