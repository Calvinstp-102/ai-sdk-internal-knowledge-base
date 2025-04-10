// utils/legal-parser.ts

import { openai } from "@ai-sdk/openai";
import { streamText, generateObject } from "ai";
import { Article, LegalBody, LegalDocument } from "@/types/legal";
import { z } from "zod";

const factsSchema = z.object({
  facts: z.array(z.string()),
});

const headSchema = z.object({
  title: z.string(),
  menimbang: z.string(),
  mengingat: z.string(),
  menetapkan: z.string(),
  type: z.enum(["PERUBAHAN", "PENCABUTAN", "PENETAPAN"]),
});

export function bersihkanHukumonlineWatermark(teks: string): string {
  return teks.replace(/www\.hukumonline\.com\/pusatdata/gi, "").trim();
}

function ambilIntroAwal(teks: string): string {
  // Regex untuk menangkap Menetapkan atau MEMUTUSKAN, lalu mengambil hingga sebelum Pasal (angka/romawi) atau BAB I
  const regex =
    /(Menetapkan\s*:|MEMUTUSKAN\s*:)([\s\S]*?)(?=\n\s*(Pasal\s+(\d+|[IVXLCDM]+)|BAB\s+I))/im;
  const match = teks.match(regex);

  if (match) {
    const batasIndex = match.index! + match[0].length;
    const intro = teks.slice(0, batasIndex).trim();

    return intro;
  } else {
    return teks;
  }
}

export async function generateHeadFromIntro(intro: string) {
  const prompt = `
Anda adalah asisten hukum. Tugas Anda adalah mengekstraksi bagian-bagian penting dari pembukaan dokumen hukum Indonesia.

PERINGATAN PENTING:
- Jangan mengubah, menyusun ulang, atau menyunting satu kata pun dari teks yang diberikan.
- Jangan menyimpulkan atau menambahkan apapun di luar yang ada di dalam teks.
- Gunakan teks apa adanya dari dokumen.

Ambil bagian berikut dari teks:
- "title": Judul lengkap peraturan (termasuk jenis dokumen, nomor, tahun, dan topik)
- "menimbang": Bagian pertimbangan yang biasanya dimulai dengan "Menimbang:"
- "mengingat": Bagian dasar hukum yang biasanya dimulai dengan "Mengingat:"
- "menetapkan": Kalimat setelah kata "Menetapkan:" atau "MEMUTUSKAN:"
- "type": Tentukan jenis dokumen berdasarkan kata kunci di title atau menetapkan — bisa "PERUBAHAN", "PENCABUTAN", atau "PENETAPAN"

Teks:
"""
${intro}
"""

Kembalikan dalam format JSON berikut:
{
  "title": "...",
  "menimbang": "...",
  "mengingat": "...",
  "menetapkan": "...",
  "type": "PERUBAHAN" | "PENCABUTAN" | "PENETAPAN"
}
`.trim();

  const result = await generateObject({
    model: openai.chat("gpt-4o-mini"),
    temperature: 0.2,
    schema: headSchema,
    prompt,
  });

  return result.object;
}

async function ekstrakHead(teks: string) {
  const intro = ambilIntroAwal(teks);
  const head = await generateHeadFromIntro(intro);
  return head;
}

// Ekstraksi batang tubuh tanpa bab
async function ekstrakBatangTubuh(teks: string) {

  const regex = /Menetapkan\s*:(.*?)\nPENJELASAN\s*\n/s;
  const match = teks.match(regex);

  if (match && match[1]) {
    const hasil = match[1].trim();

    return hasil;
  }

  console.warn(
    "⚠️ [ekstrakBatangTubuh] Penjelasan tidak ditemukan. Mengambil seluruh teks sebagai batang tubuh."
  );
  const fallback = teks.trim();

  return fallback;
}

// Pisah pasal dalam body tanpa tergantung bab
async function pisahPerpasal(
  content: string,
  type: "PERUBAHAN" | "PENETAPAN" | "PENCABUTAN",
  menetapkan: string
): Promise<Article[]> {

  const articleRegex = /^\s*Pasal\s+(\d+)[.:]?\s*$/gim;
  const matches = [...content.matchAll(articleRegex)];

  if (matches.length === 0) {
    console.warn("⚠️ [pisahPerpasal] Tidak ditemukan pasal dalam konten.");
  }

  const articles: Article[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const start = match.index!;
    const end = i + 1 < matches.length ? matches[i + 1].index! : content.length;

    const pasalHeader = match[0].trim();
    const pasalNumber = match[1];
    const pasalBody = content.slice(start + pasalHeader.length, end).trim();
    const fullPasalText = `${pasalHeader}\n${pasalBody}`;

    const parsedArticle: Article = {
      sectionType: "article",
      article: pasalNumber,
      header: pasalHeader,
      content: pasalBody,
      listOfFacts: await generateListOfFacts(fullPasalText, type, menetapkan),
    };

    articles.push(parsedArticle);
  }

  return articles;
}

// Fungsi utama untuk memparse dokumen
export async function parseLegalDocument(
  content: string,
  filename: string
): Promise<LegalDocument> {
  content = bersihkanHukumonlineWatermark(content);

  // Ekstrak bagian judul dan lainnya
  const head = await ekstrakHead(content);
  const tipeDokumen = head.type;
  const menetapkan = head.menetapkan;

  const batangTubuh = await ekstrakBatangTubuh(content);

  const penjelasan = ekstrakPenjelasan(content);

  let articleBatangTubuh: Article[] = [];
  let articlePenjelasan: Article[] = [];

  if (tipeDokumen === "PERUBAHAN") {
    articleBatangTubuh = await pisahPasalPerubahan(
      batangTubuh,
      tipeDokumen,
      menetapkan
    );
    articlePenjelasan = await pisahPenjelasanPerubahan(
      penjelasan,
      tipeDokumen,
      menetapkan
    );
  } else if (tipeDokumen === "PENETAPAN") {
    articleBatangTubuh = await pisahPerpasal(
      batangTubuh,
      tipeDokumen,
      menetapkan
    );
    articlePenjelasan = await pisahPerpasal(
      penjelasan,
      tipeDokumen,
      menetapkan
    );
  } else if (tipeDokumen === "PENCABUTAN") {
    articleBatangTubuh = await pisahPerpasal(
      batangTubuh,
      tipeDokumen,
      menetapkan
    );
    articlePenjelasan = await pisahPerpasal(
      penjelasan,
      tipeDokumen,
      menetapkan
    );
  } else {
    console.warn("[parseLegalDocument] Jenis dokumen tidak dikenali.");
  }

  const bodyBatangTubuh: LegalBody = {
    content: rebuildBodyContentFromChildren(articleBatangTubuh),
    children: articleBatangTubuh,
  };

  const bodyPenjelasan: LegalBody = {
    content: rebuildBodyContentFromChildren(articlePenjelasan),
    children: articlePenjelasan,
  };

  const result: LegalDocument = {
    title: filename.replace(".pdf", "").toUpperCase(),
    head: {
      title: head.title,
      menimbang: head.menimbang,
      mengingat: head.mengingat,
      menetapkan: head.menetapkan,
      type: head.type,
    },
    body: bodyBatangTubuh,
    penjelasan: bodyPenjelasan,
  };

  return result;
}

export async function generateListOfFacts(
  content: string,
  type: "PERUBAHAN" | "PENETAPAN" | "PENCABUTAN",
  menetapkan: string
): Promise<string[]> {
  const prompt = `
Anda adalah asisten hukum. Bacalah teks hukum berikut ini, lalu buatlah daftar fakta hukum **yang relevan dan spesifik**. 
Tiap fakta harus ditulis dalam Bahasa Indonesia formal dan disusun per pasal dan ayat secara eksplisit (jika tersedia).

Jika dalam satu bagian terdapat beberapa ayat atau perubahan, maka buatlah satu fakta terpisah untuk masing-masing ayat.
Gunakan kalimat lengkap yang menyebutkan Pasal dan Ayat.

Jika dokumen adalah PERUBAHAN:
- Tulis perubahan terhadap setiap ayat atau pasal yang disebut saja secara terpisah. 
- Hindari menulis pasal atau ayat yang tidak mengalami perubahan.
- Gunakan format seperti: 
  - "Pasal 26 ayat (3) mengatur bahwa ...",
  - "Pasal 26 ayat (4) mengatur bahwa ..."

Jika dokumen adalah PENETAPAN:
- Tulis ketentuan utama per Pasal dan Ayat secara mandiri.

Jika dokumen adalah PENCABUTAN:
- Sebutkan bagian mana yang dicabut secara jelas dan spesifik.

Konteks dokumen:
- Jenis: ${type}
- Menetapkan: ${menetapkan.trim()}

Teks hukum:
"""
${content}
"""

Buat daftar fakta hukum terstruktur dalam JSON dengan format:
{
  "facts": [
    "Fakta hukum 1...",
    "Fakta hukum 2...",
    ...
  ]
}
`.trim();

  try {
    const result = await generateObject({
      model: openai.chat("gpt-4o-mini"),
      schema: factsSchema,
      prompt,
    });

    const facts = result.object.facts;

    return facts;
  } catch (err) {
    console.error("❌ [generateListOfFacts] Gagal generate fakta hukum:", err);
    return [];
  }
}

function rebuildBodyContentFromChildren(articles: Article[]): string {
  const lines: string[] = [];

  for (const [i, article] of articles.entries()) {
    lines.push(`${article.header}`);
    if (article.content) {
      lines.push(article.content);
    }

    if (article.children) {
      for (const paragraph of article.children) {
        lines.push(`  (${paragraph.paragraph}) ${paragraph.content}`);

        if (paragraph.children) {
          for (const letter of paragraph.children) {
            lines.push(`    ${letter.letter}. ${letter.content}`);
          }
        }
      }
    }

    lines.push(""); // Spacer antara pasal
  }

  const finalOutput = lines.join("\n");

  return finalOutput;
}

// Fungsi ekstraksi Penjelasan (jika ada)
function ekstrakPenjelasan(teks: string) {
  const regex = /(PENJELASAN.*?)$/s;
  const match = teks.match(regex);

  if (match && match[1]) {
    const extracted = match[1].trim();

    return extracted;
  }

  console.warn(
    "⚠️ [ekstrakPenjelasan] Tidak ditemukan bagian 'PENJELASAN' dalam dokumen."
  );
  return "";
}

// Pisahkan pasal-pasal pada dokumen perubahan (menggunakan angka Romawi untuk Pasal I dan Pasal II)
async function pisahPasalPerubahan(
  content: string,
  type: "PERUBAHAN" | "PENETAPAN" | "PENCABUTAN",
  menetapkan: string
): Promise<Article[]> {
  const articleRegex = /^Pasal\s+([IVXLCDM]+)\s*/gm;
  const matches = [...content.matchAll(articleRegex)];

  const articles: Article[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const start = match.index!;
    const end = i + 1 < matches.length ? matches[i + 1].index! : content.length;

    const pasalHeader = match[0].trim();
    const pasalNumber = match[1];
    const pasalBody = content.slice(start + pasalHeader.length, end).trim();
    const fullPasalText = `${pasalHeader}\n${pasalBody}`;

    const parsedArticle: Article = {
      sectionType: "article",
      article: pasalNumber,
      header: pasalHeader,
      content: pasalBody,
      listOfFacts: await generateListOfFacts(fullPasalText, type, menetapkan),
    };

    articles.push(parsedArticle);
  }

  if (articles.length === 0) {
    console.warn(
      "⚠️ [pisahPasalPerubahan] Tidak ditemukan pasal dalam konten yang diberikan."
    );
  }

  return articles;
}

function ekstrakJudulUtama(teks: string): string {
  const lines = teks
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const first10Lines = lines.slice(0, 10);

  const nomorIndex = first10Lines.findIndex((line) =>
    /NOMOR\s+\d+/i.test(line)
  );

  if (nomorIndex === -1) {
    console.warn(
      "⚠️ [ekstrakJudulUtama] Tidak ditemukan baris dengan pola 'NOMOR <angka>' dalam 10 baris pertama."
    );
    return "UNKNOWN TITLE";
  }

  const titleLines = first10Lines.slice(
    Math.max(nomorIndex - 1, 0),
    Math.min(nomorIndex + 5, first10Lines.length)
  );

  const joinedTitle = titleLines
    .join(" ")
    .replace(/\s+/g, " ")
    .toUpperCase()
    .trim();

  return joinedTitle;
}

async function pisahPenjelasanPerubahan(
  content: string,
  type: string,
  menetapkan: string
): Promise<Article[]> {
  const articles: Article[] = [];

  // Deteksi semua section angka Romawi (contoh: I., II., III.)
  const romanRegex =
    /^\s*(I{1,3}|IV|V|VI{0,3}|IX|X{1,3}|XL|L|XC|C|CD|D|CM|M{0,3})\.(?=\S)/gm;
  const romanSections = [...content.matchAll(romanRegex)];

  if (romanSections.length === 0) {
    console.warn("⚠️ Tidak ditemukan section romawi pada penjelasan.");
    return [];
  }

  // Temukan section yang berisi penjelasan pasal demi pasal
  let pasalSectionStart = -1;
  for (let i = 0; i < romanSections.length; i++) {
    const currentIndex = romanSections[i].index!;
    const nextIndex =
      i + 1 < romanSections.length
        ? romanSections[i + 1].index!
        : content.length;
    const sectionText = content.slice(currentIndex, nextIndex);

    if (/Penjelasan\s+Pasal/i.test(sectionText)) {
      pasalSectionStart = currentIndex;
      break;
    }
  }

  if (pasalSectionStart === -1) {
    console.warn("⚠️ Tidak ditemukan section 'Penjelasan Pasal Demi Pasal'");
    return [];
  }

  const pasalContent = content.slice(pasalSectionStart);

  // Deteksi Pasal yang ditulis sebagai header, bukan bagian kalimat
  const articleRegex = /^(?:\s*)Pasal\s+(\d+)[.:]?\s*$/gm;
  const matches = [...pasalContent.matchAll(articleRegex)];

  if (matches.length === 0) {
    console.warn(
      "⚠️ Tidak ada baris 'Pasal X' yang berdiri sendiri ditemukan."
    );
    return [];
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const start = match.index!;
    const end =
      i + 1 < matches.length ? matches[i + 1].index! : pasalContent.length;

    const pasalHeader = match[0].trim();
    const pasalNumber = match[1];
    const pasalBody = pasalContent
      .slice(start + pasalHeader.length, end)
      .trim();
    const fullText = `${pasalHeader}\n${pasalBody}`;

    const parsed: Article = {
      sectionType: "article",
      article: pasalNumber,
      header: pasalHeader,
      content: pasalBody,
      listOfFacts: await generateListOfFacts(fullText, type as any, menetapkan),
    };

    articles.push(parsed);
  }

  return articles;
}
