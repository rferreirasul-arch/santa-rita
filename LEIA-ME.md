# Fazenda Santa Rita: Caderno de Campo

App para registrar nascimentos de terneiros. Funciona **sem sinal** e envia os
registros para uma **planilha Google** quando a internet volta. Só entram e-mails
Google autorizados na planilha.

```
Celular (app instalado)  ──►  Google Apps Script  ──►  Planilha "Fazenda Santa Rita"
  guarda tudo offline          confere o login e          abas: Nascimentos,
  (IndexedDB)                  grava/devolve os dados      Usuarios, Reproducao
```

## Arquivos

| Arquivo | Para quê |
|---|---|
| `index.html`, `styles.css`, `app.js` | O app (telas Registrar, Consulta e Painel) |
| `config.js` | Onde você cola a URL da planilha e o ID de login |
| `sw.js`, `manifest.webmanifest` | Instalação na tela inicial e funcionamento offline |
| `img/` | Marca da fazenda, ícones e fotos de fundo |
| `apps-script/Code.gs` | O “servidor”, que fica dentro da planilha |

Sem configurar nada, o app abre em **modo demonstração** (salva só no aparelho). Isso serve para testar.

---

## Configuração (uma vez, cerca de 30 minutos)

### 1. Planilha e servidor
1. No Google Drive, crie uma planilha chamada **Fazenda Santa Rita**.
2. Na planilha, abra **Extensões → Apps Script**, apague o conteúdo e cole o arquivo `apps-script/Code.gs`.
3. No menu de funções, escolha **configurar** e clique em **Executar**. Autorize quando o Google pedir.
   Isso cria as abas `Nascimentos`, `Usuarios` (já com o seu e-mail) e `Reproducao`.

### 2. ID de login do Google
1. Acesse <https://console.cloud.google.com/> e crie um projeto (ex.: “Fazenda Santa Rita”).
2. **APIs e serviços → Tela de consentimento OAuth**: tipo *Externo*, nome do app “Fazenda Santa Rita”, seu e-mail. Publique o app (status *Em produção*). Só são usados nome e e-mail, então o Google não exige verificação.
3. **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web**.
   Em **Origens JavaScript autorizadas**, adicione o endereço onde o app vai ficar (passo 3), por exemplo
   `https://SEU-USUARIO.github.io`. Para testar no computador, adicione também `http://localhost:8766` e `http://localhost`.
4. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`).
5. Volte ao Apps Script e cole esse ID na linha `const CLIENT_ID = "..."`.

### 3. Publicar o servidor
1. No Apps Script: **Implantar → Nova implantação → tipo App da Web**.
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**

   O acesso é aberto porque quem barra os intrusos é o próprio script: ele confere o login Google e a aba `Usuarios` a cada envio.
2. Copie a **URL do app da Web** (termina em `/exec`).
3. Abra `config.js` e preencha `API_URL` (a URL `/exec`) e `CLIENT_ID`.

> Quando alterar o `Code.gs` depois, use **Implantar → Gerenciar implantações → editar → Nova versão**. Assim a URL continua a mesma.

### 4. Hospedar o app (grátis, com HTTPS)
O app precisa de um endereço `https://` para funcionar offline e para o login do Google.

**Opção simples: GitHub Pages**
1. Crie uma conta em github.com e um repositório (ex.: `santa-rita`).
2. Envie todos os arquivos desta pasta, **exceto** `apps-script/` e `LEIA-ME.md` (se quiser, pode enviar também).
3. **Settings → Pages → Branch: main → Save**. Em 1 ou 2 minutos, o app fica em `https://SEU-USUARIO.github.io/santa-rita/`.
4. Confirme que `https://SEU-USUARIO.github.io` está nas origens autorizadas do passo 2.

(Netlify ou Cloudflare Pages também servem: é só arrastar a pasta.)

### 5. Instalar nos celulares
- **Android (Chrome):** abra o endereço → menu ⋮ → **Instalar app** (ou “Adicionar à tela inicial”).
- **iPhone (Safari):** abra o endereço → botão Compartilhar → **Adicionar à Tela de Início**.

Entre com a conta Google **uma vez com internet**. Depois disso, o app abre e registra mesmo sem sinal.

---

## Uso no dia a dia

- **Autorizar alguém:** na aba `Usuarios`, adicione o e-mail Gmail, o nome e `SIM` na coluna Ativo. Para bloquear, troque para `NÃO`.
- **Login só uma vez por aparelho:** no primeiro acesso a pessoa entra com o Google; a planilha libera aquele celular com uma chave permanente e o login não é mais pedido. Cada celular liberado aparece na aba `Aparelhos` (e-mail, tipo de aparelho, data e último uso). Celular perdido ou pessoa que saiu: troque `Ativo` para `NÃO` naquela linha. Tirar a pessoa da aba `Usuarios` bloqueia todos os aparelhos dela. Não edite a coluna oculta "Resumo da chave".
- **Sugestão do pai:** na aba `Reproducao`, lance *Mãe, Data da IA/IATF, Touro, Tipo*. Ao digitar a mãe no app, ele sugere o touro e calcula os dias de gestação quando o parto cai entre 240 e 320 dias após a IA. Se não houver IA compatível, aparece “Monta natural”, que pode ser editado.
- **Sem sinal:** o selo no topo mostra “X pendentes”. O envio é automático quando o sinal volta, ao abrir o app e a cada 2 minutos. Também dá para tocar em **Sincronizar**.
- **Várias pessoas ao mesmo tempo:** cada registro tem um código único, então não há duplicação. Se duas pessoas editarem o mesmo registro, vale a edição mais recente.
- **Excluir:** o registro some do app, mas na planilha ele só fica marcado como `Excluído = TRUE`. Nada se perde.
- **Não edite a coluna oculta `ID`** da planilha. Os demais campos podem ser corrigidos direto na planilha; porém, se o mesmo registro for editado depois no app, a versão do app substitui a da planilha.

## Cuidados
- Sincronize antes de trocar de celular ou de apagar os dados do navegador: registros pendentes ficam **só no aparelho** até serem enviados.
- As fotos de fundo são de **Leandro Vieira Photo and Film** (a marca d'água foi mantida e o crédito aparece na tela de entrada). Confirme com o fotógrafo se o uso no app está liberado.
