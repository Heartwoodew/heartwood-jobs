// Suburb from a job address. Kept out of the capacity screen so the run sheet
// does not have to download that screen (or leave) just to file an address.
// A price typed into an address is dropped and never shown.

export function suburbOf(address) {
  const raw = String(address || "").replace(/(?:A|AU)?\$\s?\d+(?:,\d{3})*(?:\.\d+)?/gi, " ").replace(/\$/g, " ");
  const bits = raw.split(",").map(s => s.trim()).filter(Boolean);
  const tail = bits.length > 1 ? bits[bits.length - 1] : "";
  return tail
    .replace(/\b(QLD|NSW|VIC|SA|WA|TAS|NT|ACT)\b/ig, " ")
    .replace(/\b\d{4}\b/g, " ")
    .replace(/[^A-Za-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
