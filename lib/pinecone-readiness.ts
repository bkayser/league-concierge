import { pinecone } from "./clients";

let verified = false;

export class IndexNotReadyError extends Error {
  constructor() {
    super("Vector index not ready. Run npm run create-index first.");
    this.name = "IndexNotReadyError";
  }
}

export async function ensureIndexReady(): Promise<void> {
  if (verified) return;
  try {
    await pinecone.describeIndex(
      process.env.PINECONE_INDEX_NAME ?? "oysa-docs"
    );
    verified = true;
  } catch {
    throw new IndexNotReadyError();
  }
}
