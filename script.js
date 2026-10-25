document.addEventListener('DOMContentLoaded', () => {
    const $ = id => document.getElementById(id);
    const api = async (action, options = {}) => {
        if (window.location.protocol === 'file:') {
            throw new Error('Abra o sistema pelo XAMPP: http://localhost/skalad/ (não abra o index.html diretamente).');
        }
        const response = await fetch(`api.php?action=${encodeURIComponent(action)}`, {
            headers: {'Content-Type': 'application/json'},
            credentials: 'same-origin',
            ...options
        });
        const data = await response.json().catch(() => ({ok:false,message:'Resposta inválida do servidor.'}));
        if (!response.ok || data.ok === false) throw new Error(data.message || 'Ocorreu um erro.');
        return data;
    };

    const loginPage = $('loginPage'), app = $('app'), loginMessage = $('loginMessage');

    const message = (el, text, type='success') => {
        if (!el) return;
        el.textContent = text;
        el.className = `message show ${type}`;
    };

    async function iniciar() {
        try {
            const r = await api('me');
            loginPage.classList.add('hidden');
            app.classList.remove('hidden');
            $('loggedUser').textContent = r.usuario.nome;
            await carregarTudo();
        } catch (_) {
            loginPage.classList.remove('hidden');
            app.classList.add('hidden');
        }
    }

    $('loginForm').addEventListener('submit', async e => {
        e.preventDefault();
        message(loginMessage, 'Entrando...', 'success');
        try {
            const r = await api('login', {
                method:'POST',
                body: JSON.stringify({email:$('loginEmail').value.trim(), senha:$('loginSenha').value})
            });
            loginPage.classList.add('hidden');
            app.classList.remove('hidden');
            $('loggedUser').textContent = r.usuario.nome;
            $('loginForm').reset();
            loginMessage.className='message';
            await carregarTudo();
        } catch (err) {
            message(loginMessage, err.message, 'error');
        }
    });

    $('logoutBtn').addEventListener('click', async () => {
        await api('logout');
        app.classList.add('hidden');
        loginPage.classList.remove('hidden');
        $('loginForm').reset();
    });

    const titles = {
        dashboard:['Dashboard','Visão geral do estoque.'],
        estoque:['Estoque','Produtos e quantidades cadastradas.'],
        movimentacoes:['Movimentações','Entradas e saídas do estoque.'],
        qr:['QR Code','Identificação dos produtos.'],
        alertas:['Alertas','Itens que precisam de atenção.'],
        configuracoes:['Configurações','Usuários do sistema.']
    };
    document.querySelectorAll('.nav-link[data-page]').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const page=link.dataset.page;
            document.querySelectorAll('.nav-link[data-page]').forEach(x=>x.classList.remove('active'));
            link.classList.add('active');
            document.querySelectorAll('.page').forEach(x=>x.classList.add('hidden'));
            $(`page-${page}`).classList.remove('hidden');
            $('pageTitle').textContent=titles[page][0];
            $('pageDescription').textContent=titles[page][1];
            if(page==='dashboard') carregarDashboard();
            if(page==='estoque') carregarProdutos();
            if(page==='movimentacoes') carregarMovimentacoes();
            if(page==='qr') carregarSelects();
            if(page==='alertas') carregarAlertas();
            if(page==='configuracoes') carregarUsuarios();
        });
    });

    function status(p) {
        if (+p.quantidade <= 0) return ['Crítico','critical'];
        if (+p.quantidade <= +p.estoque_minimo) return ['Estoque baixo','low'];
        return ['Normal','ok'];
    }
    let produtos=[];

    async function carregarDashboard() {
        const r=await api('dashboard');
        $('kpiProdutos').textContent=r.produtos;
        $('kpiQuantidade').textContent=r.quantidade;
        $('kpiBaixo').textContent=r.baixo;
        $('kpiCriticos').textContent=r.criticos;
        
        $('dashboardMovimentacoes').innerHTML=r.movimentacoes.length
            ? r.movimentacoes.map(m=>`<p class="hint">${new Date(String(m.data).replace(' ','T')).toLocaleString('pt-BR')} — <strong>${escapeHtml(m.produto||'Produto')}</strong>: ${m.tipo} (${m.quantidade})</p>`).join('')
            : '<p class="muted">Nenhuma movimentação registrada.</p>';
        const alerts=r.alertas||[];
        $('dashboardAlertas').innerHTML=alerts.length ? alerts.slice(0,5).map(p=>{
            const reasons=[]; if(+p.quantidade<=0) reasons.push('estoque zerado'); else if(+p.quantidade<=+p.estoque_minimo) reasons.push('estoque baixo'); if(!p.localizacao||!p.localizacao.trim()) reasons.push('sem localização');
            return `<div class="alert ${+p.quantidade<=0?'danger':'warning'}"><strong>${escapeHtml(p.nome)}</strong><span> — ${reasons.join(' e ')} (${p.quantidade} un.)</span></div>`;
        }).join('') : '<p class="muted">Nenhum alerta no momento.</p>';
        desenharGraficoMovimentacoes(r.grafico||[]);
        desenharGraficoEstoque([Math.max(0,Number(r.produtos)-Number(r.baixo)), Math.max(0,Number(r.baixo)-Number(r.criticos)), Number(r.criticos)]);

    }


    // Gráficos desenhados diretamente no canvas: não dependem de bibliotecas externas.
    function prepararCanvas(canvas, altura=260) {
        const largura = Math.max(280, canvas.parentElement.clientWidth - 36);
        const escala = window.devicePixelRatio || 1;
        canvas.width = Math.round(largura * escala);
        canvas.height = Math.round(altura * escala);
        canvas.style.width = '100%'; canvas.style.height = `${altura}px`;
        const ctx = canvas.getContext('2d'); ctx.setTransform(escala,0,0,escala,0,0);
        ctx.clearRect(0,0,largura,altura);
        return {ctx, largura, altura};
    }
    function desenharGraficoMovimentacoes(registros) {
        const canvas=$('graficoMovimentacoes'); if(!canvas)return;
        const {ctx,largura,altura}=prepararCanvas(canvas);
        const labels=[], entradas=[], saidas=[], agora=new Date();
        for(let i=6;i>=0;i--){
            const d=new Date(agora); d.setDate(agora.getDate()-i);
            const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            labels.push(d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}));
            entradas.push(registros.filter(x=>String(x.dia).slice(0,10)===key&&String(x.tipo).toLowerCase()==='entrada').reduce((sum,x)=>sum+Number(x.quantidade||0),0));
            saidas.push(registros.filter(x=>String(x.dia).slice(0,10)===key&&String(x.tipo).toLowerCase()==='saida').reduce((sum,x)=>sum+Number(x.quantidade||0),0));
        }
        const max=Math.max(1,...entradas,...saidas), left=34, right=12, top=20, bottom=40, plotH=altura-top-bottom, plotW=largura-left-right;
        ctx.font='12px Arial'; ctx.textAlign='right'; ctx.fillStyle='#667085'; ctx.strokeStyle='#e5e7eb';
        for(let i=0;i<=4;i++){const y=top+plotH*i/4;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(largura-right,y);ctx.stroke();ctx.fillText(String(Math.round(max*(4-i)/4)),left-7,y+4);}
        const grupo=plotW/labels.length, bw=Math.min(18,grupo*.28);
        labels.forEach((label,i)=>{const x=left+i*grupo+grupo/2;const h1=entradas[i]/max*plotH,h2=saidas[i]/max*plotH;ctx.fillStyle='#15803d';ctx.fillRect(x-bw-2,top+plotH-h1,bw,h1);ctx.fillStyle='#d97706';ctx.fillRect(x+2,top+plotH-h2,bw,h2);ctx.fillStyle='#667085';ctx.textAlign='center';ctx.fillText(label,x,altura-18);});
        ctx.textAlign='left';ctx.fillStyle='#15803d';ctx.fillRect(left,altura-7,10,10);ctx.fillStyle='#344054';ctx.fillText('Entradas',left+15,altura+1-2);ctx.fillStyle='#d97706';ctx.fillRect(left+85,altura-7,10,10);ctx.fillStyle='#344054';ctx.fillText('Saídas',left+100,altura+1-2);
    }
    function desenharGraficoEstoque(valores) {
        const canvas=$('graficoEstoque'); if(!canvas)return;
        const {ctx,largura,altura}=prepararCanvas(canvas,260); const total=valores.reduce((a,b)=>a+b,0); const cx=largura/2, cy=108, raio=Math.min(72,largura*.19), interno=raio*.58;
        const cores=['#15803d','#d97706','#dc2626']; let ang=-Math.PI/2;
        if(total===0){ctx.beginPath();ctx.arc(cx,cy,raio,0,Math.PI*2);ctx.strokeStyle='#e5e7eb';ctx.lineWidth=raio-interno;ctx.stroke();}
        else valores.forEach((v,i)=>{if(v<=0)return;const fim=ang+(v/total)*Math.PI*2;ctx.beginPath();ctx.arc(cx,cy,raio,ang,fim);ctx.strokeStyle=cores[i];ctx.lineWidth=raio-interno;ctx.stroke();ang=fim;});
        ctx.fillStyle='#172033';ctx.textAlign='center';ctx.font='bold 23px Arial';ctx.fillText(String(total),cx,cy+7);ctx.font='12px Arial';ctx.fillStyle='#667085';ctx.fillText('produtos',cx,cy+25);
        const nomes=['Normal','Estoque baixo','Crítico']; const inicio=cx-(largura>420?150:125); const y=218;
        nomes.forEach((nome,i)=>{const colX=inicio+i*(largura>420?105:88);ctx.fillStyle=cores[i];ctx.fillRect(colX,y-10,10,10);ctx.fillStyle='#344054';ctx.textAlign='left';ctx.font='12px Arial';ctx.fillText(`${nome}: ${valores[i]}`,colX+14,y);});
    }
    window.addEventListener('resize',()=>{if(!$('page-dashboard').classList.contains('hidden'))carregarDashboard().catch(err=>console.error(err));});

    async function carregarProdutos() {
        const r=await api('produtos'); produtos=r.produtos;
        renderProdutos();
        preencherSelects();
    }
    function renderProdutos() {
        const busca=($('buscaProduto').value||'').toLowerCase();
        const filtro=$('filtroStatus').value;
        const rows=produtos.filter(p=>{
            const [txt]=status(p);
            const okf=filtro==='todos'||(filtro==='normal'&&txt==='Normal')||(filtro==='baixo'&&txt==='Estoque baixo')||(filtro==='critico'&&txt==='Crítico');
            return okf && `${p.nome} ${p.categoria} ${p.localizacao}`.toLowerCase().includes(busca);
        });
        $('tabelaEstoque').innerHTML=rows.map(p=>{
            const [txt,cls]=status(p);
            return `<tr><td><strong>${escapeHtml(p.nome)}</strong></td><td>${escapeHtml(p.categoria)}</td><td>R$ ${Number(p.preco).toFixed(2).replace('.',',')}</td><td>${p.quantidade}</td><td>${p.estoque_minimo}</td><td>${escapeHtml(p.localizacao)}</td><td><span class="status ${cls}">${txt}</span></td><td><button class="btn small" data-edit="${p.id_produto}">Editar</button> <button class="btn small danger" data-delete="${p.id_produto}">Excluir</button></td></tr>`;
        }).join('') || '<tr><td colspan="8">Nenhum produto encontrado.</td></tr>';
        document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editarProduto(+b.dataset.edit));
        document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>excluirProduto(+b.dataset.delete));
    }
    $('buscaProduto').addEventListener('input',renderProdutos);
    $('filtroStatus').addEventListener('change',renderProdutos);

    function preencherSelects() {
        ['movProduto','qrProduto'].forEach(id=>{
            $(id).innerHTML='<option value="">Selecione...</option>'+produtos.map(p=>`<option value="${p.id_produto}">${escapeHtml(p.nome)}</option>`).join('');
        });
    }
    async function carregarSelects(){ await carregarProdutos(); }

    $('novoProdutoBtn').onclick=()=>abrirProduto();
    function abrirProduto(p=null) {
        $('produtoModalTitulo').textContent=p?'Editar produto':'Novo produto';
        $('produtoId').value=p?.id_produto||'';
        $('produtoNome').value=p?.nome||'';
        $('produtoCategoria').value=p?.categoria||'';
        $('produtoPreco').value=p?.preco||0;
        $('produtoQuantidade').value=p?.quantidade||0;
        $('produtoMinimo').value=p?.estoque_minimo ?? 10;
        $('produtoLocalizacao').value=p?.localizacao||'';
        $('produtoObservacaoLocal').value=p?.observacao_local||'';
        $('produtoModal').classList.remove('hidden');
    }
    function editarProduto(id){ abrirProduto(produtos.find(p=>p.id_produto===id)); }
    $('produtoForm').addEventListener('submit',async e=>{
        e.preventDefault();
        const id=$('produtoId').value;
        const data={id:+id,nome:$('produtoNome').value,categoria:$('produtoCategoria').value,preco:+$('produtoPreco').value,quantidade:+$('produtoQuantidade').value,localizacao:$('produtoLocalizacao').value,estoque_minimo:+$('produtoMinimo').value,observacao_local:$('produtoObservacaoLocal').value};
        try {
            await api('produto',{method:id?'PUT':'POST',body:JSON.stringify(data)});
            $('produtoModal').classList.add('hidden'); await carregarProdutos(); await carregarDashboard();
        } catch(err){ alert(err.message); }
    });
    async function excluirProduto(id){
        if(!confirm('Excluir este produto?')) return;
        try { await api('produto',{method:'DELETE',body:JSON.stringify({id})}); await carregarProdutos(); await carregarDashboard(); }
        catch(err){ alert(err.message); }
    }

    $('movimentacaoForm').addEventListener('submit',async e=>{
        e.preventDefault();
        try {
            await api('movimentacao',{method:'POST',body:JSON.stringify({produto:+$('movProduto').value,tipo:$('movTipo').value,quantidade:+$('movQuantidade').value,observacao:$('movObservacao').value})});
            e.target.reset(); message($('movMessage'),'Movimentação registrada.','success'); await carregarProdutos(); await carregarMovimentacoes(); await carregarDashboard();
        } catch(err){ message($('movMessage'),err.message,'error'); }
    });
    async function carregarMovimentacoes(){
        const r=await api('movimentacoes');
        $('tabelaMovimentacoes').innerHTML=r.movimentacoes.map(m=>`<tr><td>${new Date(m.data.replace(' ','T')).toLocaleString('pt-BR')}</td><td>${escapeHtml(m.produto||'')}</td><td>${m.tipo}</td><td>${m.quantidade}</td><td>${escapeHtml(m.observacao||'')}</td></tr>`).join('')||'<tr><td colspan="5">Nenhuma movimentação.</td></tr>';
    }

    async function carregarAlertas(){
        await carregarProdutos();
        const baixos=produtos.filter(p=>+p.quantidade<=+p.estoque_minimo || !p.localizacao || p.localizacao==='Sem localização');
        $('listaAlertas').innerHTML=baixos.length?baixos.map(p=>{const motivos=[];if(+p.quantidade<=0)motivos.push('estoque zerado');else if(+p.quantidade<=+p.estoque_minimo)motivos.push('estoque baixo');if(!p.localizacao||p.localizacao==='Sem localização')motivos.push('sem localização');return `<div class="alert ${+p.quantidade<=0?'danger':'warning'}"><strong>${escapeHtml(p.nome)}</strong> — ${motivos.join(' e ')} (${p.quantidade} unidades).</div>`;}).join(''):'<p>Nenhum alerta no momento.</p>';
    }

    $('novoUsuarioBtn').onclick=()=>abrirUsuario();
    function abrirUsuario(u=null){
        $('usuarioForm').reset(); $('usuarioId').value=u?.id_usuario||'';
        $('usuarioModalTitulo').textContent=u?'Editar usuário':'Cadastrar usuário';
        $('usuarioNome').value=u?.nome||''; $('usuarioEmail').value=u?.email||'';
        $('usuarioSenha').required=!u; $('usuarioSenha').value='';
        $('usuarioPerfil').value=u?.perfil==='admin'?'Administrador':'Operador';
        $('usuarioAtivo').value=u?.status==='inativo'?'false':'true';
        $('usuarioModal').classList.remove('hidden');
    }
    $('usuarioForm').addEventListener('submit',async e=>{
        e.preventDefault(); const id=$('usuarioId').value;
        try {
            await api('usuario',{method:id?'PUT':'POST',body:JSON.stringify({id:+id,nome:$('usuarioNome').value.trim(),email:$('usuarioEmail').value.trim(),senha:$('usuarioSenha').value,perfil:$('usuarioPerfil').value,ativo:$('usuarioAtivo').value==='true'})});
            $('usuarioModal').classList.add('hidden'); await carregarUsuarios();
            const me=await api('me'); $('loggedUser').textContent=me.usuario.nome;
        } catch(err){ alert(err.message); }
    });
    async function carregarUsuarios(){
        try {
            const r=await api('usuarios'); window.skaladUsuarios=r.usuarios;
            $('tabelaUsuarios').innerHTML=r.usuarios.map(u=>`<tr><td>${escapeHtml(u.nome)}</td><td>${escapeHtml(u.email)}</td><td>${u.perfil==='admin'?'Administrador':'Operador'}</td><td><span class="status ${u.status==='ativo'?'ok':'low'}">${u.status==='ativo'?'Ativo':'Inativo'}</span></td><td><button class="btn small" data-user-edit="${u.id_usuario}">Editar</button> <button class="btn small danger" data-user-delete="${u.id_usuario}">Excluir</button></td></tr>`).join('')||'<tr><td colspan="5">Nenhum usuário cadastrado.</td></tr>';
            document.querySelectorAll('[data-user-edit]').forEach(b=>b.onclick=()=>abrirUsuario(window.skaladUsuarios.find(u=>+u.id_usuario===+b.dataset.userEdit)));
            document.querySelectorAll('[data-user-delete]').forEach(b=>b.onclick=async()=>{const id=+b.dataset.userDelete;const usr=window.skaladUsuarios.find(u=>+u.id_usuario===id);if(!usr||!confirm(`Excluir o usuário ${usr.nome}? Essa ação não pode ser desfeita.`))return;try{await api('usuario',{method:'DELETE',body:JSON.stringify({id})});await carregarUsuarios();}catch(err){alert(err.message);}});
        } catch(err){ $('tabelaUsuarios').innerHTML=`<tr><td colspan="5">${escapeHtml(err.message)}</td></tr>`; }
    }

    document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).classList.add('hidden'));

    $('gerarQrBtn').onclick=async e=>{
        e.preventDefault();
        const p=produtos.find(x=>x.id_produto===+$('qrProduto').value);
        if(!p){$('qrArea').innerHTML='<p class="muted">Selecione um produto.</p>';return;}
        const code=`SKALAD-${p.id_produto}`;
        const localizacao=p.localizacao && p.localizacao !== 'Sem localização' ? p.localizacao : 'Sem localização';
        const observacao=p.observacao_local || '';
        const qrData=[`Produto: ${p.nome}`,`Código: ${code}`,`Localização: ${localizacao}`,observacao?`Observação: ${observacao}`:''].filter(Boolean).join('\\n');
        try {
            await api('qrcode',{method:'POST',body:JSON.stringify({id_produto:p.id_produto,codigo:code})});
            $('qrArea').innerHTML=`<img src="https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrData)}" alt="QR Code"><div class="qr-info"><strong>${escapeHtml(p.nome)}</strong><br>${escapeHtml(code)}<br>${escapeHtml(localizacao)}${observacao?`<br>${escapeHtml(observacao)}`:''}<p class="hint">Código vinculado ao produto e salvo no banco de dados.</p></div>`;
        } catch(err) {
            $('qrArea').innerHTML=`<p class="message show error">${escapeHtml(err.message)}</p>`;
        }
    };
    let produtoQrAtual=null; let cameraStream=null; let cameraVideo=null; let cameraFrame=null; let cameraDetector=null; let cameraBusy=false;
    function extrairCodigoQr(valor){
        const txt=String(valor||'').trim();
        const match=txt.match(/SKALAD-(\d+)/i) || txt.match(/(?:^|\n)\s*(?:Código|Codigo)\s*:\s*(\d+)\s*(?:\n|$)/i);
        return match ? match[1] : txt.replace(/^SKALAD-/i,'').trim();
    }
    function selecionarProdutoPorCodigo(valor){
        const code=extrairCodigoQr(valor); const p=produtos.find(x=>String(x.id_produto)===String(code));
        if(!p){$('resultadoQr').textContent='Produto não encontrado. Confira se o QR Code pertence ao Skalad.';$('movimentoQrRapido').classList.add('hidden');produtoQrAtual=null;return false;}
        produtoQrAtual=p; $('produtoQrEncontrado').textContent=p.nome; $('estoqueQrAtual').textContent=`Estoque atual: ${p.quantidade} unidade(s) • Código SKALAD-${p.id_produto}`;
        $('resultadoQr').textContent=`Produto identificado: ${p.nome}. Escolha entrada ou saída abaixo.`; $('movimentoQrRapido').classList.remove('hidden'); $('qrQuantidadeMovimento').value=1; return true;
    }
    async function pararCamera(silencioso=false){
        if(cameraFrame)cancelAnimationFrame(cameraFrame); cameraFrame=null;
        if(cameraStream){cameraStream.getTracks().forEach(track=>track.stop());cameraStream=null;}
        if(cameraVideo){cameraVideo.srcObject=null;cameraVideo.remove();cameraVideo=null;}
        cameraBusy=false;
        if(!silencioso)$('resultadoQr').textContent='Leitor de câmera parado.';
    }
    async function lerQuadrosCamera(){
        if(!cameraVideo||!cameraStream)return;
        if(!cameraBusy&&cameraDetector&&cameraVideo.readyState>=2){
            cameraBusy=true;
            try{const codes=await cameraDetector.detect(cameraVideo);if(codes.length&&selecionarProdutoPorCodigo(codes[0].rawValue)){await pararCamera(true);$('resultadoQr').textContent='QR Code lido. Confirme a entrada ou saída.';return;}}
            catch(err){console.warn('Falha ao ler QR:',err);}
            finally{cameraBusy=false;}
        }
        cameraFrame=requestAnimationFrame(lerQuadrosCamera);
    }
    $('iniciarCameraBtn').onclick=async()=>{
        if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){$('resultadoQr').textContent='Este endereço não permite acessar a câmera. Abra o Skalad em localhost ou HTTPS.';return;}
        if(!('BarcodeDetector' in window)){$('resultadoQr').textContent='Seu navegador não oferece leitura de QR integrada. Atualize o Google Chrome para usar a câmera.';return;}
        try{
            await pararCamera(true);
            cameraDetector=new BarcodeDetector({formats:['qr_code']});
            cameraStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});
            cameraVideo=document.createElement('video');cameraVideo.setAttribute('playsinline','');cameraVideo.setAttribute('autoplay','');cameraVideo.muted=true;cameraVideo.style.width='100%';cameraVideo.style.maxWidth='520px';cameraVideo.style.borderRadius='12px';
            $('qrCameraLeitor').replaceChildren(cameraVideo);cameraVideo.srcObject=cameraStream;await cameraVideo.play();
            $('resultadoQr').textContent='Câmera ativa. Aponte para o QR Code do produto.';lerQuadrosCamera();
        }catch(err){await pararCamera(true);let motivo=err.message||String(err);if(err.name==='NotAllowedError')motivo='Permissão da câmera negada. Clique no ícone ao lado do endereço do site e permita a câmera.';else if(err.name==='NotFoundError')motivo='Nenhuma câmera foi encontrada neste aparelho.';else if(err.name==='NotReadableError')motivo='A câmera está sendo usada por outro aplicativo. Feche-o e tente novamente.';$('resultadoQr').textContent=`Não foi possível abrir a câmera: ${motivo}. Em celular, use HTTPS; HTTP comum não libera a câmera.`;}
    };
    $('pararCameraBtn').onclick=()=>pararCamera(false);
    $('registrarQrMovimentoBtn').onclick=async()=>{
        if(!produtoQrAtual)return; const quantidade=+$('qrQuantidadeMovimento').value;
        if(!Number.isInteger(quantidade)||quantidade<1){alert('Informe uma quantidade maior que zero.');return;}
        try{
            await api('movimentacao',{method:'POST',body:JSON.stringify({produto:+produtoQrAtual.id_produto,tipo:$('qrTipoMovimento').value,quantidade,observacao:$('qrObservacaoMovimento').value||'Movimentação pelo QR Code'})});
            $('resultadoQr').textContent='Movimentação registrada com sucesso.'; $('movimentoQrRapido').classList.add('hidden'); produtoQrAtual=null;
            await carregarProdutos(); await carregarMovimentacoes(); await carregarDashboard();
        }catch(err){$('resultadoQr').textContent=err.message;}
    };
    $('verTodosAlertasBtn').onclick=()=>document.querySelector('[data-page="alertas"]').click();

    function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
    async function carregarTudo(){ await carregarProdutos(); await carregarDashboard(); }
    iniciar();
});
