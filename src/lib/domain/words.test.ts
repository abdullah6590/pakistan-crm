import { describe, expect, it } from "vitest";
import { amountInWords } from "./words";

// Expected values are real legacy outputs (Ccash/Vcash.Iword) with spacing normalised.
const LEGACY_EXAMPLES: [number, string][] = [
  [1300, "One Thousand Three Hundred"],
  [12000, "Twelve Thousand"],
  [13824, "Thirteen Thousand Eight Hundred and Twenty-Four"],
  [20307, "Twenty Thousand Three Hundred and Seven"],
  [39483, "Thirty-Nine Thousand Four Hundred and Eighty-Three"],
  [47200, "Forty-Seven Thousand Two Hundred"],
  [1000000, "One Million"],
  [1200000, "One Million Two Hundred Thousand"],
  [1914002, "One Million Nine Hundred and Fourteen Thousand and Two"],
  [2232005, "Two Million Two Hundred and Thirty-Two Thousand and Five"],
  [16707562, "Sixteen Million Seven Hundred and Seven Thousand Five Hundred and Sixty-Two"],
];

describe("amount in words (BR-18)", () => {
  it.each(LEGACY_EXAMPLES)("[LEGACY] %i", (amount, words) => {
    expect(amountInWords(amount)).toBe(words);
  });

  it("writes zero as Zero (legacy wrote lower-case 'zero')", () => {
    expect(amountInWords(0)).toBe("Zero");
  });
});
