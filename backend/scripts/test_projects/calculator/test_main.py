"""Калькулятордың тесттері: python -m unittest"""
import unittest

from main import evaluate, format_number


class EvaluateTest(unittest.TestCase):
    def test_precedence(self):
        self.assertEqual(evaluate("2 + 3 * (4 - 1)"), 11)

    def test_power_and_unary(self):
        self.assertEqual(evaluate("-2 ** 10"), -1024)

    def test_division(self):
        self.assertEqual(format_number(evaluate("7 / 2")), "3.5")
        self.assertEqual(evaluate("7 // 2"), 3)

    def test_zero_division(self):
        with self.assertRaises(ZeroDivisionError):
            evaluate("1 / 0")

    def test_rejects_code(self):
        for bad in ("__import__('os')", "abs(-1)", "x + 1", "True + 1"):
            with self.assertRaises(ValueError):
                evaluate(bad)


if __name__ == "__main__":
    unittest.main()
