use text_splitter::{TextSplitter, ChunkConfig};

/// Split long text into chunks for embedding, with optional overlap
pub fn chunk_text(text: &str, max_chars: usize, _overlap_chars: usize) -> Vec<String> {
    let config = ChunkConfig::new(max_chars).with_overlap(_overlap_chars).unwrap_or(ChunkConfig::new(max_chars));
    let splitter = TextSplitter::new(config);

    splitter
        .chunks(text)
        .map(|c| c.to_string())
        .collect()
}
