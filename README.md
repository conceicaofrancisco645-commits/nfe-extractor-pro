# NF-e Extractor Pro

Transforma DANFEs em PDF em uma planilha Excel (.xlsx) pronta para estoque, logística, compras e Power BI. Tudo roda no navegador: as notas não são enviadas a nenhum servidor.

## Como abrir e instalar como app (PWA)

**No Windows (recomendado)**
1. Dê dois cliques em `INICIAR.bat`. Ele liga um servidor local só neste computador e abre o app em `http://localhost:8765`.
2. No Chrome ou Edge, clique em **Instalar app** (barra lateral) ou no ícone de instalação na barra de endereço.
3. Pronto: o NF-e Extractor Pro ganha ícone próprio, abre em janela própria e funciona offline depois do primeiro acesso.

> Abrir o `index.html` com dois cliques também funciona para extrair e exportar, mas o navegador só permite **instalar** o app quando ele é aberto por `http://localhost` ou `https://`.

**No celular ou tablet**
Publique a pasta em qualquer hospedagem com HTTPS (Netlify, GitHub Pages, Vercel). Depois:
- Android/Chrome: menu ⋮ → **Instalar app**.
- iPhone/iPad (Safari): **Compartilhar** → **Adicionar à Tela de Início**.

## Uso
1. **Painel** → importe um ou vários PDFs (botão ou arrastar e soltar).
2. **Conferência** → revise a tabela. Linhas em âmbar estão pendentes; passe o mouse em “Pendente” para ver o motivo. Edite qualquer célula, adicione ou exclua linhas, filtre por nota, NCM e CST.
3. **Exportar para Excel (.xlsx)** → planilha consolidada (com `NUMERO_NF` e `DATA_EMISSAO`). Para uma nota só, use o botão de download no card da nota ou “Exportar nota filtrada”.
4. **Histórico** → reabra ou exporte de novo notas já processadas (guardado em IndexedDB, sem o PDF).

## Como a extração funciona
- Lê **todas as páginas** com PDF.js, guardando a posição (x, y) de cada texto.
- Localiza o cabeçalho de **DADOS DO PRODUTO / SERVIÇO** e atribui cada valor à coluna certa pela posição — por isso não confunde VL. TOTAL com as colunas de desconto/ICMS/IPI que vêm depois.
- Junta descrições quebradas em várias linhas e separa o texto de informação adicional do item (ex.: “Isenção do ICMS – artigo 160…”), que não entra na descrição.
- Mantém códigos e NCM como texto (zeros à esquerda preservados) e interpreta números brasileiros (1.234,5600).
- PDFs digitalizados (imagem) passam por OCR com Tesseract.js e ficam sempre marcados para conferência.

## Auditoria automática
- QTDE × VL. UNITÁRIO = VL. TOTAL (tolerância de arredondamento de R$ 0,01).
- Soma dos itens × **VALOR TOTAL DOS PRODUTOS** informado na nota.
- Campos ausentes, NCM fora do padrão, CST não identificado.
- Códigos repetidos são **sinalizados**, nunca excluídos.
- Nenhum valor da nota é corrigido automaticamente. “Marcar como conferido” registra a sua revisão manual.

## Excel gerado
- **DADOS_NF**: `COD.PROD. | DESCRIÇÃO DO PRODUTO / SERVIÇO | NCM/SH | CST | QTDE | VL. UNITÁRIO | VL. TOTAL` (+ `NUMERO_NF | DATA_EMISSAO` no consolidado). Cabeçalho azul-escuro com letra branca, filtro automático, primeira linha congelada, bordas discretas, números com 4 casas, códigos e NCM como texto.
- **RESUMO_NF**: número, emitente, CNPJ, data de emissão, páginas, produtos, valor extraído, valor informado na nota e status.

## Arquivos
| Arquivo | Função |
|---|---|
| `index.html` | Estrutura das telas |
| `style.css` | Identidade visual |
| `app.js` | Telas, conferência, histórico e instalação PWA |
| `extractor.js` | Motor de leitura da DANFE |
| `excel-export.js` | Geração do .xlsx |
| `manifest.webmanifest`, `sw.js`, `icons/` | App instalável e modo offline |
| `INICIAR.bat`, `servidor.ps1` | Servidor local para Windows |

## Bibliotecas (CDN, guardadas offline pelo app)
PDF.js 3.11 · ExcelJS 4.4 (no lugar do SheetJS gratuito, que não grava cores, bordas nem linha congelada) · Tesseract.js 5 · Lucide · Chart.js 4.

## Aviso
A extração é assistida. Confira os dados antes de qualquer uso fiscal ou contábil.
