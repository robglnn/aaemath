import katex from "katex";
for (const t of ["\\square", "\\blacksquare", "\\rule{0.7em}{0.7em}"]) {
  try {
    const html = katex.renderToString(t, { displayMode: false, throwOnError: true });
    console.log("=== " + t + " ===");
    console.log(html);
  } catch (e) {
    console.log("=== " + t + " ERR " + e.message);
  }
}
