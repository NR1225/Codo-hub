"""Консольдік калькулятор: өрнекті жазыңыз, мысалы 2 + 3 * (4 - 1) немесе 2 ** 10.

Тек сандар мен + - * / // % ** амалдары рұқсат етілген (eval қолданылмайды).
Шығу: exit немесе Ctrl+C.
"""
import ast
import operator

OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
UNARY = {ast.UAdd: operator.pos, ast.USub: operator.neg}


def evaluate(expression: str) -> float:
    return _eval(ast.parse(expression, mode="eval").body)


def _eval(node: ast.AST) -> float:
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in OPS:
        left, right = _eval(node.left), _eval(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > 1000:
            raise ValueError("Дәреже тым үлкен")
        return OPS[type(node.op)](left, right)
    if isinstance(node, ast.UnaryOp) and type(node.op) in UNARY:
        return UNARY[type(node.op)](_eval(node.operand))
    raise ValueError("Тек сандар мен + - * / // % ** амалдары")


def format_number(value: float) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(round(value, 10))


def main() -> None:
    print("Калькулятор. Өрнек жазыңыз (шығу: exit)")
    while True:
        try:
            line = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not line:
            continue
        if line.lower() in ("exit", "quit", "шығу"):
            break
        try:
            print("=", format_number(evaluate(line)))
        except ZeroDivisionError:
            print("Қате: нөлге бөлуге болмайды")
        except (SyntaxError, ValueError, OverflowError) as err:
            print("Қате:", err.msg if isinstance(err, SyntaxError) else err)
    print("Сау болыңыз!")


if __name__ == "__main__":
    main()
