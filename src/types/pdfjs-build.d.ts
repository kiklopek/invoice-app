// pdfjs-dist dodává typy jen pro hlavní vstup; build/pdf.mjs je tentýž modul.
declare module "pdfjs-dist/build/pdf.mjs" {
  export * from "pdfjs-dist";
}
