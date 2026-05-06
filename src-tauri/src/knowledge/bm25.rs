use std::collections::HashMap;

/// Simple tokenizer: splits on whitespace for Latin, splits characters for CJK.
/// Returns a list of lowercase tokens.
pub fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();

    for ch in text.chars() {
        if ch.is_alphanumeric() {
            if ch.is_ascii_alphabetic() {
                current.push(ch.to_ascii_lowercase());
            } else if ch.is_ascii_digit() {
                current.push(ch);
            } else {
                // CJK character or other: push current word, then this char as token
                if !current.is_empty() {
                    tokens.push(current.clone());
                    current.clear();
                }
                tokens.push(ch.to_string());
            }
        } else {
            if !current.is_empty() {
                tokens.push(current.clone());
                current.clear();
            }
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }

    // Filter short tokens
    tokens.into_iter().filter(|t| t.len() >= 1).collect()
}

/// BM25 scoring parameters
const K1: f32 = 1.2;
const B: f32 = 0.75;

/// Compute BM25 score for a set of query tokens against a document.
/// `doc_tokens`: token frequencies in the document
/// `doc_len`: total token count in document
/// `avg_doc_len`: average document length across corpus
/// `idf`: inverse document frequency for each token
pub fn bm25_score(
    query_tokens: &[String],
    doc_freqs: &HashMap<String, usize>,  // token → count in this doc
    doc_len: usize,
    avg_doc_len: f32,
    idf: &HashMap<String, f32>,
) -> f32 {
    let mut score = 0.0;
    for token in query_tokens {
        if let Some(&df) = doc_freqs.get(token) {
            if let Some(&idf_val) = idf.get(token) {
                let tf = df as f32;
                let numerator = tf * (K1 + 1.0);
                let denominator = tf + K1 * (1.0 - B + B * (doc_len as f32 / avg_doc_len));
                score += idf_val * numerator / denominator;
            }
        }
    }
    score
}

/// Build IDF map from a collection of documents.
/// `docs`: each doc is a vector of (unique tokens with their frequencies)
/// Returns a map from token → IDF value
pub fn build_idf(docs: &[HashMap<String, usize>]) -> HashMap<String, f32> {
    let n = docs.len() as f32;
    let mut df = HashMap::<String, usize>::new();

    for doc_tokens in docs {
        for token in doc_tokens.keys() {
            *df.entry(token.clone()).or_insert(0) += 1;
        }
    }

    df.into_iter()
        .map(|(token, count)| {
            let idf = ((n - count as f32 + 0.5) / (count as f32 + 0.5) + 1.0).ln();
            (token, idf.max(0.0))
        })
        .collect()
}

/// Tokenize text and return frequency map
pub fn token_freqs(text: &str) -> HashMap<String, usize> {
    let mut freqs = HashMap::new();
    for token in tokenize(text) {
        *freqs.entry(token).or_insert(0) += 1;
    }
    freqs
}
