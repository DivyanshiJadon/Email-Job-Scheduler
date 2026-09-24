const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function extractEmails(text: string): string[] {
  const emails = new Set<string>();
  const rows = text.replace(/\r\n/g, "\n").split("\n");
  for (const row of rows) {
    const cells = splitCsvRow(row.trim());
    for (const cell of cells) {
      const matches = cell.match(EMAIL_RE);
      if (matches) {
        for (const m of matches) emails.add(m.toLowerCase());
      }
    }
  }
  return Array.from(emails);
}

function splitCsvRow(line: string): string[] {
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