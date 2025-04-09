// app/(chat)/api/files/upload/route.ts

import { auth } from "@/app/(auth)/auth";
import { insertChunks } from "@/app/db";
import { getPdfContentFromUrl } from "@/utils/pdf";
import { openai } from "@ai-sdk/openai";
import { put } from "@vercel/blob";
import { embedMany } from "ai";
import { parseLegalDocument } from "@/utils/legal-parser";
import { saveJsonToFile } from "@/utils/file";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const filename = searchParams.get("filename");

  const session = await auth();
  if (!session || !session.user || !filename) {
    return NextResponse.redirect("/login");
  }

  const { user } = session;

  if (!request.body) {
    return new NextResponse("Request body is empty", { status: 400 });
  }

  // Upload file ke Vercel Blob
  const { downloadUrl } = await put(`${user.email}/${filename}`, request.body, {
    access: "public",
  });

  // Ekstrak teks dari PDF
  const content = await getPdfContentFromUrl(downloadUrl);

  // Parsing dokumen perundang-undangan
  const parsed = await parseLegalDocument(content, filename);

  // Simpan hasil JSON ke local folder ./outputs/
  await saveJsonToFile(filename.replace(".pdf", ""), parsed);

  return NextResponse.json({ success: true });
}
