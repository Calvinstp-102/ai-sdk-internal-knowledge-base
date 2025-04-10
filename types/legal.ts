// types/legal.ts

export type SubNumber = {
  sectionType: "subNumber";
  number: string;
  content: string;
};

export type SubLetter = {
  sectionType: "subLetter";
  letter: string;
  content: string;
  children?: SubNumber[];
};

export type Number = {
  sectionType: "number";
  number: string;
  content: string;
  children?: SubLetter[];
};

export type Letter = {
  sectionType: "letter";
  letter: string;
  content: string;
  children?: Number[];
};

export type Paragraph = {
  sectionType: "paragraph";
  paragraph: string;
  content: string;
  children?: Letter[];
};

export type Article = {
  sectionType: "article";
  article: string;
  header: string;
  content: string;
  listOfFacts?: string[];
  children?: Paragraph[];
};

export type LegalBody = {
  content: string;
  children: Article[];
};

export type LegalHead = {
  title: string;
  menimbang: string;
  mengingat: string;
  menetapkan: string;
  type: "PERUBAHAN" | "PENETAPAN" | "PENCABUTAN";
};

export type LegalDocument = {
  title: string;
  head: LegalHead; // ✅ tambahkan ini
  considerations?: any;
  considering?: any;
  decides?: any;
  body: LegalBody;
  penjelasan: LegalBody;
};