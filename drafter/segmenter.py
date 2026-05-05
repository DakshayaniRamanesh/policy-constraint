import spacy

class PolicySegmenter:
    def __init__(self, model="en_core_web_sm"):
        try:
            self.nlp = spacy.load(model)
        except OSError:
            # Fallback or download if missing
            print(f"Downloading spacy model {model}...")
            spacy.cli.download(model)
            self.nlp = spacy.load(model)

    def segment(self, text):
        """
        Splits raw text into clean, individual sentences, avoiding blending headers.
        """
        sentences = []
        for line in text.split('\n'):
            line = line.strip()
            if not line:
                continue
            doc = self.nlp(line)
            for sent in doc.sents:
                clean_sent = sent.text.strip()
                if clean_sent:
                    sentences.append(clean_sent)
        return sentences
