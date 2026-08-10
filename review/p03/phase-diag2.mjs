// Scratch: instrument one median learner's item mix by patching the sim's globals is hard,
// so re-implement the counting by monkey-patching via an env flag is not available. Instead:
// run the sim with a tiny population and print per-phase counts by importing nothing — we just
// re-run the loop here in miniature using the same JSON.
