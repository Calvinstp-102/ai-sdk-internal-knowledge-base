// utils/file.ts

import fs from "fs/promises";
import path from "path";

export async function saveJsonToFile(filename: string, data: any) {
  const outputDir = path.resolve("./outputs");
  const outputPath = path.join(outputDir, `${filename}.json`);

  try {
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(data, null, 2), "utf-8");
    console.log(`✅ File JSON berhasil disimpan di ${outputPath}`);
  } catch (err) {
    console.error("❌ Gagal menyimpan file JSON:", err);
  }
}
