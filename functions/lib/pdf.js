import { PDFDocument, StandardFonts } from "pdf-lib";

function wrapText(text, font, fontSize, maxWidth) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") { lines.push(""); continue; }
    const words = paragraph.split(" ");
    let currentLine = "";
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(testLine, fontSize) > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine);
  }
  return lines;
}

export async function generateContractPdf({ contractText, signatureImageBuffer, signerName, signedAt }) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pngImage = await pdfDoc.embedPng(signatureImageBuffer);

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 50;
  const fontSize = 10;
  const lineHeight = 14;
  const maxWidth = pageWidth - margin * 2;

  const lines = wrapText(contractText, font, fontSize, maxWidth);

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  function ensureSpace(needed) {
    if (y - needed < margin) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  }

  for (const line of lines) {
    ensureSpace(lineHeight);
    page.drawText(line, { x: margin, y, size: fontSize, font });
    y -= lineHeight;
  }

  ensureSpace(50);
  y -= 20;
  page.drawText("Signed electronically:", { x: margin, y, size: fontSize, font: boldFont });
  y -= 14;

  const imgDims = pngImage.scale(200 / pngImage.width);
  ensureSpace(imgDims.height + 20);
  page.drawImage(pngImage, { x: margin, y: y - imgDims.height, width: imgDims.width, height: imgDims.height });
  y -= imgDims.height + 4;

  page.drawText(`${signerName} — ${signedAt}`, { x: margin, y, size: 9, font });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
