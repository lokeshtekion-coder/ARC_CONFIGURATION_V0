import * as XLSX from "xlsx";
import type { StoreRecord } from "./storesDb";
import {
  STORE_EXPORT_HEADERS,
  groupStoresByMonth,
} from "./storesExcelShared";

export function exportStoresToExcel(
  records: StoreRecord[],
  fileBaseName = "stores"
): void {
  if (!records.length) {
    throw new Error("No stores available to export");
  }

  const workbook = XLSX.utils.book_new();
  const monthGroups = groupStoresByMonth(records);

  for (const group of monthGroups) {
    const jsonRows = group.rows.map((row) => {
      const ordered: Record<string, string> = {};
      STORE_EXPORT_HEADERS.forEach((header) => {
        ordered[header] = row[header] ?? "";
      });
      return ordered;
    });

    const sheet = XLSX.utils.json_to_sheet(jsonRows, {
      header: [...STORE_EXPORT_HEADERS],
    });

    sheet["!cols"] = [
      { wch: 16 },
      { wch: 14 },
      { wch: 32 },
      { wch: 18 },
      { wch: 12 },
      { wch: 16 },
      { wch: 16 },
      { wch: 10 },
      { wch: 18 },
      { wch: 18 },
      { wch: 20 },
      { wch: 16 },
      { wch: 18 },
      { wch: 16 },
      { wch: 18 },
      { wch: 20 },
      { wch: 24 },
    ];

    XLSX.utils.book_append_sheet(workbook, sheet, group.sheetName);
  }

  const safeBase = fileBaseName.replace(/[^a-z0-9-_]+/gi, "_");
  XLSX.writeFile(workbook, `${safeBase}.xlsx`);
}
