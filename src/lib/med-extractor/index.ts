// Public surface of the distilled medication extractor's shared logic - the
// label scheme, BIO decoder, and deterministic assembler. Imported by the
// browser runtime (src/lib/local-model), the Node eval suite
// (scripts/evals/suites/med-extractor-student), and the data-generation
// aligner. Pure, dependency-free, safe for the client bundle.
export * from "./labels";
export * from "./decode";
export * from "./assembler";
