import nltk
from nltk.sentiment import SentimentIntensityAnalyzer
from nltk.tokenize import word_tokenize, sent_tokenize
from collections import Counter

class SentimentAnalyzer:
    def __init__(self):
        nltk.download('vader_lexicon')
        nltk.download('punkt')
        self.sia = SentimentIntensityAnalyzer()

    def analyze_sentiment(self, text):
        sentences = sent_tokenize(text)
        overall_sentiment = {'pos': 0, 'neu': 0, 'neg': 0, 'compound': 0}
        sentence_count = len(sentences)

        for sentence in sentences:
            sentiment = self.sia.polarity_scores(sentence)
            for key in overall_sentiment:
                overall_sentiment[key] += sentiment[key]

        for key in overall_sentiment:
            overall_sentiment[key] /= sentence_count

        return overall_sentiment

    def most_common_words(self, text, num_words=5):
        words = word_tokenize(text)
        words = [word.lower() for word in words if word.isalnum()]
        word_freq = Counter(words)
        return word_freq.most_common(num_words)

if __name__ == "__main__":
    analyzer = SentimentAnalyzer()
    text = """This is an amazing tool for boosting productivity. 
              However, sometimes it feels a bit overwhelming with all the options."""
    
    sentiment = analyzer.analyze_sentiment(text)
    common_words = analyzer.most_common_words(text)
    
    print(f"Sentiment Analysis: {sentiment}")
    print(f"Most Common Words: {common_words}")
