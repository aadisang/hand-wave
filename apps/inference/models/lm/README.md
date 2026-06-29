# English KenLM Assets

`neutral_english_4gram.kenlm` is the measured default. It is the Medium KenLM trie
model from ImagineVille's December 2019 English word language models. It is a
neutral lowercased 4-gram English model licensed under Creative Commons
Attribution 4.0.

`neutral_english_unigrams.txt` is the matching 100K vocabulary file from the same
model family.

Source: https://imagineville.org/software/lm/dec19/

`wiki_en_token.unigrams.txt` is a neutral top-probability 500K lowercase unigram
subset extracted from BramVanroy's Wikipedia token 5-gram ARPA. The matching
`wiki_en_token.arpa.bin` model is not committed because it is larger than common
Git LFS object limits. Download it from Hugging Face when evaluating that model.

Source: https://huggingface.co/BramVanroy/kenlm_wikipedia_en
