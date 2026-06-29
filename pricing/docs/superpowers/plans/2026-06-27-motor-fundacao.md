# Motor de Precificação — Fundação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a base do motor de precificação — o contrato de dados de entrada, a biblioteca de markup (conversões, faixas, degraus, piso) e a carga/validação do JSON semanal — tudo com TDD e sem dependência de banco ou UI.

**Architecture:** Pacote Python puro `motor/` que lê um arquivo `dados_AAAA-Sxx.json` (produzido futuramente pelo extrator) e expõe tipos e funções determinísticas. Esta fundação não precifica ainda — entrega os blocos (modelo de dados + matemática de markup + carga) que os planos seguintes (zonas KVI/cauda/ponta, estado, orquestração) vão consumir.

**Tech Stack:** Python 3.11+, biblioteca padrão apenas, `pytest` para testes. Sem pandas/numpy nesta fase.

## Global Constraints

- **Python 3.11+** (sintaxe de tipos `str | Path`, `tuple[float, ...]`).
- **Markup é sempre sobre o custo, como fração:** `markup = (preco - custo) / custo`; `preco = custo * (1 + markup)`. Margem (sobre o preço) **nunca** é usada.
- **Degraus em fração de markup:** 0,3 pp = `0.003`. Faixas: markup `< 0.15` → `0.003`; `0.15–0.30` → `0.005`; `0.30–0.50` → `0.007`; `> 0.50` → `0.010`.
- **Piso `preco_min` é inviolável:** nenhuma função pode retornar preço abaixo dele.
- **O motor nunca acessa o banco** — só lê JSON em disco.
- **Código e nomes em português** (estilo do projeto). Dependências mínimas.
- Cada tarefa termina com `pytest` verde e um commit.

---

## Estrutura de arquivos (locked-in)

```
pricing-atacaderj/
├── motor/
│   ├── __init__.py
│   ├── markup.py        # conversões preço↔markup, piso, faixas, degraus
│   └── modelo.py        # ProdutoEntrada (registro tipado de 1 SKU)
│   └── carga.py         # load_dados(): JSON → list[ProdutoEntrada] validada
├── tests/
│   ├── __init__.py
│   ├── test_markup.py
│   ├── test_modelo.py
│   ├── test_carga.py
│   └── fixtures/
│       └── dados_exemplo.json
├── requirements-dev.txt
└── pytest.ini
```

Responsabilidades: `markup.py` = matemática pura (sem I/O); `modelo.py` = forma de 1 SKU; `carga.py` = ler+validar+tipar o JSON. Cada arquivo tem uma responsabilidade só.

---

### Task 1: Scaffolding + conversões de markup e piso

**Files:**
- Create: `requirements-dev.txt`
- Create: `pytest.ini`
- Create: `motor/__init__.py` (vazio)
- Create: `tests/__init__.py` (vazio)
- Create: `motor/markup.py`
- Test: `tests/test_markup.py`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `markup_de_preco(custo: float, preco: float) -> float`
  - `preco_de_markup(custo: float, markup: float) -> float`
  - `aplicar_piso(preco: float, preco_min: float) -> float`

- [ ] **Step 1: Criar o scaffolding**

`requirements-dev.txt`:
```
pytest>=8.0
```

`pytest.ini`:
```ini
[pytest]
testpaths = tests
python_files = test_*.py
```

Criar `motor/__init__.py` e `tests/__init__.py` vazios. Depois instalar: `pip install -r requirements-dev.txt`.

- [ ] **Step 2: Escrever os testes que falham**

`tests/test_markup.py`:
```python
import pytest
from motor.markup import markup_de_preco, preco_de_markup, aplicar_piso


def test_markup_de_preco_20pct():
    assert markup_de_preco(10.0, 12.0) == pytest.approx(0.20)


def test_preco_de_markup_20pct():
    assert preco_de_markup(10.0, 0.20) == pytest.approx(12.0)


def test_markup_e_preco_sao_inversos():
    custo, preco = 7.5, 9.3
    m = markup_de_preco(custo, preco)
    assert preco_de_markup(custo, m) == pytest.approx(preco)


def test_custo_invalido_levanta_erro():
    with pytest.raises(ValueError):
        markup_de_preco(0.0, 12.0)
    with pytest.raises(ValueError):
        preco_de_markup(-1.0, 0.2)


def test_aplicar_piso_segura_o_preco():
    assert aplicar_piso(8.0, 9.0) == 9.0     # abaixo do piso -> piso
    assert aplicar_piso(10.0, 9.0) == 10.0   # acima do piso -> mantém
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `pytest tests/test_markup.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'motor.markup'`.

- [ ] **Step 4: Implementar o mínimo**

`motor/markup.py`:
```python
"""Matemática de markup (sobre o custo) e piso de preço. Sem I/O."""


def markup_de_preco(custo: float, preco: float) -> float:
    """Markup como fração sobre o custo. Ex.: (10, 12) -> 0.20."""
    if custo <= 0:
        raise ValueError("custo deve ser > 0")
    return (preco - custo) / custo


def preco_de_markup(custo: float, markup: float) -> float:
    """Preço a partir do markup (fração). Ex.: (10, 0.20) -> 12.0."""
    if custo <= 0:
        raise ValueError("custo deve ser > 0")
    return custo * (1 + markup)


def aplicar_piso(preco: float, preco_min: float) -> float:
    """Nunca deixa o preço furar o piso (trava inviolável)."""
    return max(preco, preco_min)
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pytest tests/test_markup.py -v`
Expected: PASS (5 testes).

- [ ] **Step 6: Commit**

```bash
git add requirements-dev.txt pytest.ini motor/__init__.py tests/__init__.py motor/markup.py tests/test_markup.py
git commit -m "feat(motor): conversoes de markup e piso de preco"
```

---

### Task 2: Faixas e degraus de markup

**Files:**
- Modify: `motor/markup.py` (adicionar `degrau_da_faixa`)
- Test: `tests/test_markup.py` (adicionar casos)

**Interfaces:**
- Consumes: `motor/markup.py` da Task 1.
- Produces:
  - `degrau_da_faixa(markup: float) -> float` — tamanho do degrau (±, em fração de markup) pela faixa do markup atual.
  - Constantes `FAIXAS: tuple[tuple[float, float], ...]` e `DEGRAU_TOPO: float`.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao fim de `tests/test_markup.py`:
```python
from motor.markup import degrau_da_faixa


def test_degrau_por_faixa():
    assert degrau_da_faixa(0.10) == pytest.approx(0.003)   # < 15%
    assert degrau_da_faixa(0.20) == pytest.approx(0.005)   # 15–30%
    assert degrau_da_faixa(0.40) == pytest.approx(0.007)   # 30–50%
    assert degrau_da_faixa(0.80) == pytest.approx(0.010)   # > 50%


def test_degrau_nas_fronteiras():
    # fronteira é inclusiva por baixo: 0.15 já é a faixa do meio
    assert degrau_da_faixa(0.15) == pytest.approx(0.005)
    assert degrau_da_faixa(0.30) == pytest.approx(0.007)
    assert degrau_da_faixa(0.50) == pytest.approx(0.010)
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pytest tests/test_markup.py -v`
Expected: FAIL com `ImportError: cannot import name 'degrau_da_faixa'`.

- [ ] **Step 3: Implementar o mínimo**

Adicionar ao fim de `motor/markup.py`:
```python
# Faixas de markup -> degrau (±, em fração de markup). Limite é exclusivo:
# markup < limite usa o degrau daquela linha; senão cai na próxima.
FAIXAS: tuple[tuple[float, float], ...] = (
    (0.15, 0.003),
    (0.30, 0.005),
    (0.50, 0.007),
)
DEGRAU_TOPO: float = 0.010


def degrau_da_faixa(markup: float) -> float:
    """Degrau (±, fração de markup) pela faixa do markup atual do item."""
    for limite, degrau in FAIXAS:
        if markup < limite:
            return degrau
    return DEGRAU_TOPO
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pytest tests/test_markup.py -v`
Expected: PASS (7 testes).

- [ ] **Step 5: Commit**

```bash
git add motor/markup.py tests/test_markup.py
git commit -m "feat(motor): degrau de markup por faixa"
```

---

### Task 3: Modelo de dados do SKU

**Files:**
- Create: `motor/modelo.py`
- Test: `tests/test_modelo.py`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `ProdutoEntrada` — dataclass frozen com: `interno: str`, `produto: str`, `emb: str`, `curva: str`, `custo: float`, `preco_praticado: float`, `preco_min: float`, `giro_semana: float`, `giro_ewma90: float`, `preco_vizinhos: tuple[float, ...]`.
  - Propriedade `eh_kvi: bool` (True quando há preço de vizinho).

- [ ] **Step 1: Escrever os testes que falham**

`tests/test_modelo.py`:
```python
from motor.modelo import ProdutoEntrada


def _produto(**over):
    base = dict(
        interno="1001", produto="azeitona xpto", emb="vidro 200g",
        curva="C", custo=8.0, preco_praticado=12.0, preco_min=9.0,
        giro_semana=20.0, giro_ewma90=22.0, preco_vizinhos=(),
    )
    base.update(over)
    return ProdutoEntrada(**base)


def test_cria_produto_e_le_campos():
    p = _produto()
    assert p.interno == "1001"
    assert p.custo == 8.0
    assert p.preco_vizinhos == ()


def test_eh_kvi_quando_tem_vizinho():
    assert _produto(preco_vizinhos=(11.5, 12.0)).eh_kvi is True
    assert _produto(preco_vizinhos=()).eh_kvi is False


def test_produto_eh_imutavel():
    import dataclasses
    p = _produto()
    try:
        p.custo = 1.0
    except dataclasses.FrozenInstanceError:
        return
    raise AssertionError("ProdutoEntrada deveria ser frozen")
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pytest tests/test_modelo.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'motor.modelo'`.

- [ ] **Step 3: Implementar o mínimo**

`motor/modelo.py`:
```python
"""Registro tipado de um SKU para o motor de precificação."""
from dataclasses import dataclass


@dataclass(frozen=True)
class ProdutoEntrada:
    interno: str
    produto: str
    emb: str
    curva: str                       # "A" | "B" | "C"
    custo: float
    preco_praticado: float
    preco_min: float                 # piso inviolável
    giro_semana: float
    giro_ewma90: float               # baseline suavizado vindo do extrator
    preco_vizinhos: tuple[float, ...]  # vazio quando não-KVI

    @property
    def eh_kvi(self) -> bool:
        """KVI = tem preço de vizinho pra comparar."""
        return len(self.preco_vizinhos) > 0
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pytest tests/test_modelo.py -v`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add motor/modelo.py tests/test_modelo.py
git commit -m "feat(motor): modelo ProdutoEntrada"
```

---

### Task 4: Carga e validação do JSON semanal

**Files:**
- Create: `motor/carga.py`
- Create: `tests/fixtures/dados_exemplo.json`
- Test: `tests/test_carga.py`

**Interfaces:**
- Consumes: `ProdutoEntrada` (Task 3).
- Produces:
  - `load_dados(caminho: str | Path) -> list[ProdutoEntrada]`
  - `CAMPOS_OBRIGATORIOS: tuple[str, ...]`

- [ ] **Step 1: Criar a fixture de exemplo**

`tests/fixtures/dados_exemplo.json`:
```json
{
  "gerado_em": "2026-06-27 08:00:00",
  "semana": "2026-S27",
  "total": 2,
  "produtos": [
    {
      "interno": "1001", "produto": "azeitona xpto", "emb": "vidro 200g",
      "curva": "c", "custo": 8.0, "preco_praticado": 12.0, "preco_min": 9.0,
      "giro_semana": 20.0, "giro_ewma90": 22.0, "preco_vizinhos": []
    },
    {
      "interno": "2002", "produto": "arroz tipo 1", "emb": "5kg",
      "curva": "a", "custo": 18.0, "preco_praticado": 21.6, "preco_min": 19.0,
      "giro_semana": 300.0, "giro_ewma90": 290.0, "preco_vizinhos": [21.5, 22.0]
    }
  ]
}
```

- [ ] **Step 2: Escrever os testes que falham**

`tests/test_carga.py`:
```python
import json
from pathlib import Path

import pytest
from motor.carga import load_dados

FIXTURE = Path(__file__).parent / "fixtures" / "dados_exemplo.json"


def test_carrega_dois_produtos():
    produtos = load_dados(FIXTURE)
    assert len(produtos) == 2
    assert produtos[0].interno == "1001"


def test_normaliza_curva_para_maiuscula():
    produtos = load_dados(FIXTURE)
    assert produtos[0].curva == "C"
    assert produtos[1].curva == "A"


def test_kvi_detectado_pelos_vizinhos():
    produtos = load_dados(FIXTURE)
    assert produtos[0].eh_kvi is False      # vizinhos []
    assert produtos[1].eh_kvi is True       # tem vizinhos


def test_campo_faltando_levanta_erro(tmp_path):
    ruim = {"produtos": [{"interno": "9", "produto": "x"}]}
    caminho = tmp_path / "ruim.json"
    caminho.write_text(json.dumps(ruim), encoding="utf-8")
    with pytest.raises(ValueError) as exc:
        load_dados(caminho)
    assert "custo" in str(exc.value)


def test_arquivo_sem_produtos_retorna_lista_vazia(tmp_path):
    caminho = tmp_path / "vazio.json"
    caminho.write_text(json.dumps({"produtos": []}), encoding="utf-8")
    assert load_dados(caminho) == []
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `pytest tests/test_carga.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'motor.carga'`.

- [ ] **Step 4: Implementar o mínimo**

`motor/carga.py`:
```python
"""Carga e validação do JSON semanal -> list[ProdutoEntrada]."""
import json
from pathlib import Path

from motor.modelo import ProdutoEntrada

CAMPOS_OBRIGATORIOS: tuple[str, ...] = (
    "interno", "produto", "emb", "curva", "custo",
    "preco_praticado", "preco_min", "giro_semana", "giro_ewma90",
)


def load_dados(caminho: str | Path) -> list[ProdutoEntrada]:
    """Lê o dados_*.json, valida campos obrigatórios e tipa cada SKU."""
    dados = json.loads(Path(caminho).read_text(encoding="utf-8"))
    produtos: list[ProdutoEntrada] = []
    for i, reg in enumerate(dados.get("produtos", [])):
        faltando = [c for c in CAMPOS_OBRIGATORIOS if c not in reg]
        if faltando:
            raise ValueError(f"produto #{i} ({reg.get('interno', '?')}) sem campos: {faltando}")
        produtos.append(
            ProdutoEntrada(
                interno=str(reg["interno"]),
                produto=str(reg["produto"]),
                emb=str(reg["emb"]),
                curva=str(reg["curva"]).upper(),
                custo=float(reg["custo"]),
                preco_praticado=float(reg["preco_praticado"]),
                preco_min=float(reg["preco_min"]),
                giro_semana=float(reg["giro_semana"]),
                giro_ewma90=float(reg["giro_ewma90"]),
                preco_vizinhos=tuple(float(v) for v in reg.get("preco_vizinhos", [])),
            )
        )
    return produtos
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pytest tests/test_carga.py -v`
Expected: PASS (5 testes).

- [ ] **Step 6: Rodar a suíte inteira**

Run: `pytest -v`
Expected: PASS (todos: markup 7 + modelo 3 + carga 5 = 15 testes).

- [ ] **Step 7: Commit**

```bash
git add motor/carga.py tests/test_carga.py tests/fixtures/dados_exemplo.json
git commit -m "feat(motor): carga e validacao do JSON semanal"
```

---

## Self-Review

**Cobertura do spec (nesta fundação):**
- §5 (dados de entrada) → Task 3 (`ProdutoEntrada`) + Task 4 (carga/validação). ✅ (todos os campos do §5 estão no modelo.)
- §8.1 (degrau por faixa de markup) → Task 2 (`degrau_da_faixa`). ✅
- §10 (piso inviolável) → Task 1 (`aplicar_piso`). ✅
- §3 (markup, não margem) → Task 1 (conversões só por markup). ✅
- **Fora desta fundação (planos seguintes):** §6 zonas KVI/cauda/ponta, §8.2 freio EWMA+controle, §8.3 braço de teste, §9 camada de IA, §11 estado/reconciliação, §12 UI/export, §5 extrator MySQL. Registrados na seção "Próximos planos" abaixo.

**Placeholder scan:** sem TBD/TODO; todo passo tem código real e comando com saída esperada. ✅

**Type consistency:** `ProdutoEntrada` (Task 3) é consumido por `load_dados` (Task 4) com os mesmos nomes/tipos de campo; `eh_kvi` definido na Task 3 é testado na Task 4. `degrau_da_faixa`/`aplicar_piso`/conversões expostos com as assinaturas declaradas nos blocos *Interfaces*. ✅

---

## Próximos planos (decomposição do design)

1. **Motor — Fundação** ← este plano.
2. **Motor — Zonas de preço:** KVI (paridade + 3-5 estrela), Cauda (hill-climb por faixa), Ponta (seleção + promo). (spec §6, §8.1)
3. **Motor — Freio e braço de teste:** EWMA 90d + relativo ao controle + persistência; teste deliberado 5 SKUs/±8%. (spec §8.2, §8.3)
4. **Estado + reconciliação:** JSONs datados em disco, reconciliação via próxima extração. (spec §11)
5. **Orquestração:** roda a semana, monta `sugestoes_*.json`. (spec §4, §12)
6. **Extrator MySQL** — ⛔ *bloqueado: precisa do schema real (tabela/colunas).* (spec §5)
7. **UI de revisão (HTML/JS) + endpoint serve.py.** (spec §11, §12)
8. **Export Excel + PDF.** (spec §12)
9. **Camada de IA (opcional)** com travas anti-overfit. (spec §9)
