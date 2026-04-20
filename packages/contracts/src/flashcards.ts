export interface Flashcard {
  id: string;
  prompt: string;
  answer: string;
  tags: string[];
}

export interface FlashcardSet {
  id: string;
  conversationId: string;
  generatedAt: string;
  cards: Flashcard[];
}
