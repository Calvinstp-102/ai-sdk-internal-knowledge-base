// utils/legal-parser.ts

import { openai } from "@ai-sdk/openai";
import { streamText, generateObject } from "ai";
import { z } from "zod";
import { Article, LegalBody, LegalDocument, Paragraph } from "@/types/legal";
import fs from "fs/promises";

async function ekstrakJudul(teks: string) {
  const pola = /(.*?)(?=Menimbang:)/s;
  const cocok = teks.match(pola);

  if (cocok && cocok[1]) {
    return cocok[1].trim();
  } else {
    return "";
  }
}

// async function sendJudulToLLM(text: string): Promise<string> {
//   const prompt = `
// Pilahlah judul undang undang negara indonesia ini, ambil hanya judulnya saja, dan buat dalam uppercase. Buatlah seakurat mungkin

// Content:
// """
// ${text}
// """
// `;

//   try {
//     const result = await streamText({
//       model: openai.chat("gpt-4o"),
//       messages: [{ role: "user", content: prompt.trim() }],
//     });

//     const parsed = result?.choices?.[0]?.message?.content || "";
//     if (!parsed) throw new Error("No title result from LLM");
//     return parsed;
//   } catch (err) {
//     console.error("Error:", err);
//     return "";
//   }
// }

async function ekstrakBatangTubuh(teks: string) {
  let regex = /(BAB I.*?)\nPENJELASAN\s*\n/s;
  let match = teks.match(regex);

  if (!match) {
    regex = /(BAB I.*?)$/s;
  }

  match = teks.match(regex);
  
  if (match && match[1]) {
    return match[1].trim();
  }
  return "";
}

function pisahBab(batangTubuh: string): Array<{ nomor: string; isi: string }> {
  const regex = /BAB (\w+)(.*?)(?=BAB|$)/gs;
  return Array.from(batangTubuh.matchAll(regex), (match) => ({
    nomor: match[1],
    isi: match[2].trim(),
  }));
}

function ekstrakPenjelasan(teks: string) {
  const regex = /(PENJELASAN.*?)$/s;
  const match = teks.match(regex);

  if (match && match[1]) {
    return match[1].trim();
  }
  return "";
}

async function pisahPerpasal(content: string) {
  const articleRegex = /^Pasal\s+(\d+)[.:]?\s*/gm;
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

    // Call GPT-4o to parse into structured Article
    const parsedArticle = await parsePasalWithLLM(
      pasalNumber,
      pasalHeader,
      pasalBody
    );

    // Call GPT-4o again to generate list of facts
    const facts = await generateListOfFacts(fullPasalText);

    parsedArticle.listOfFacts = facts;
    articles.push(parsedArticle);
  }
  return articles;
}

export async function parseLegalDocument(
  content: string,
  filename: string
): Promise<LegalDocument> {
  // const ekstrak_judul = await ekstrakJudul(content);
  // const judul         = await sendJudulToLLM(ekstrak_judul);
  const batang_tubuh = await ekstrakBatangTubuh(content);
  const bab_bab = pisahBab(batang_tubuh);
  const penjelasan = ekstrakPenjelasan(content);

  const article_batang_tubuh = await pisahPerpasal(batang_tubuh);
  const article_penjelasan = await pisahPerpasal(penjelasan);

  const body_batang_tubuh: LegalBody = {
    content: rebuildBodyContentFromChildren(article_batang_tubuh),
    children: article_batang_tubuh,
  };

  const body_penjelasan: LegalBody = {
    content: rebuildBodyContentFromChildren(article_penjelasan),
    children: article_penjelasan,
  };

  return {
    title: filename.replace(".pdf", "").toUpperCase(),
    body: body_batang_tubuh,
    penjelasan: body_penjelasan,
  };
}

async function parsePasalWithLLM(
  articleNumber: string,
  header: string,
  body: string
): Promise<Article> {
  return {
    sectionType: "article",
    article: articleNumber,
    header,
    content: body,
  };
}

export async function generateListOfFacts(content: string): Promise<string[]> {
  const prompt = `
You are a legal assistant. Summarize the following Indonesian legal article into 3–7 factual bullet points. Be precise and keep each point short. Don't add interpretations.

Text:
"""
${content}
"""
`;

  try {
    const { textStream } = await streamText({
      model: openai.chat("gpt-4o"),
      messages: [{ role: "user", content: prompt.trim() }],
    });

    let fullText = "";
    for await (const chunk of textStream) {
      fullText += chunk;
    }

    const facts = fullText
      .split("\n")
      .map((line) => line.trim().replace(/^[-•*]\s*/, ""))
      .filter((line) => line.length > 0);

    return facts;
  } catch (err) {
    console.error("❌ Error generating listOfFacts:", err);
    return [];
  }
}

function rebuildBodyContentFromChildren(articles: Article[]): string {
  const lines: string[] = [];

  for (const article of articles) {
    lines.push(`${article.header}`);
    if (article.content) lines.push(article.content);

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

    lines.push("");
  }

  return lines.join("\n");
}
