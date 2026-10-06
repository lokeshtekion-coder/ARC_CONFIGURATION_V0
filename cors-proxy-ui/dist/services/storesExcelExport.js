import * as XLSX from "xlsx";
import { STORE_EXPORT_HEADERS, groupStoresByMonth, } from "./storesExcelShared";
export function exportStoresToExcel(records, fileBaseName = "stores") {
    if (!records.length) {
        throw new Error("No stores available to export");
    }
    const workbook = XLSX.utils.book_new();
    const monthGroups = groupStoresByMonth(records);
    for (const group of monthGroups) {
        const jsonRows = group.rows.map((row) => {
            const ordered = {};
            STORE_EXPORT_HEADERS.forEach((header) => {
                ordered[header] = row[header] ?? "";
            });
            return ordered;
        });
        const sheet = XLSX.utils.json_to_sheet(jsonRows, {
            header: [...STORE_EXPORT_HEADERS],
        });
        // Updated column widths to match the 25 columns mapped in STORE_EXPORT_HEADERS
        sheet["!cols"] = [
            { wch: 16 }, // Tekion ID
            { wch: 14 }, // Dealer ID
            { wch: 32 }, // Dealership
            { wch: 18 }, // Go Live
            { wch: 12 }, // T Label
            { wch: 16 }, // IMP Type
            { wch: 16 }, // Pre-Prod
            { wch: 10 }, // POD
            { wch: 18 }, // Blueprint Parts
            { wch: 20 }, // Blueprint Parts Time
            { wch: 18 }, // Blueprint Service
            { wch: 20 }, // Blueprint Service Time
            { wch: 20 }, // Blueprint Accounting
            { wch: 20 }, // Blueprint Accounting Time
            { wch: 16 }, // Blueprint CRM
            { wch: 20 }, // Blueprint CRM Time
            { wch: 18 }, // Blueprint Analytics
            { wch: 20 }, // Blueprint Analytics Time
            { wch: 16 }, // SignOff Parts
            { wch: 20 }, // SignOff Parts Time
            { wch: 18 }, // SignOff Service
            { wch: 20 }, // SignOff Service Time
            { wch: 20 }, // SignOff Accounting
            { wch: 20 }, // SignOff Accounting Time
            { wch: 24 }, // Status Fetched At
            { wch: 20 }, // Setup Data Fetched At
            { wch: 18 }, // Assignee
        ];
        XLSX.utils.book_append_sheet(workbook, sheet, group.sheetName);
    }
    const safeBase = fileBaseName.replace(/[^a-z0-9-_]+/gi, "_");
    XLSX.writeFile(workbook, `${safeBase}.xlsx`);
}
