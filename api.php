<?php
session_start();
header('Content-Type: application/json; charset=utf-8');

$host = '127.0.0.1';
$db   = 'skalad_db';
$user = 'root';
$pass = '';

function out($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

try {
    $pdo = new PDO("mysql:host=$host;charset=utf8mb4", $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
    ]);
    $pdo->exec("CREATE DATABASE IF NOT EXISTS `$db` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci");
    $pdo->exec("USE `$db`");

    // Garante que a instalação tenha as tabelas básicas, mesmo se o SQL ainda não tiver sido importado.
    $pdo->exec("CREATE TABLE IF NOT EXISTS usuario (
        id_usuario INT NOT NULL,
        id_movimentacoes INT DEFAULT NULL,
        nome VARCHAR(100) DEFAULT NULL,
        email VARCHAR(150) DEFAULT NULL,
        status ENUM('ativo','inativo') DEFAULT 'ativo',
        senha VARCHAR(255) DEFAULT NULL,
        perfil ENUM('admin','usuario') DEFAULT 'usuario',
        PRIMARY KEY (id_usuario),
        UNIQUE KEY uq_usuario_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");

    $pdo->exec("CREATE TABLE IF NOT EXISTS alertas (id_alerta INT NOT NULL AUTO_INCREMENT, mensagem VARCHAR(255), PRIMARY KEY(id_alerta)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS estoque (id_estoque INT NOT NULL AUTO_INCREMENT, id_alertas INT DEFAULT NULL, localizacao VARCHAR(100), status ENUM('ativo','inativo') DEFAULT 'ativo', acoes VARCHAR(255), PRIMARY KEY(id_estoque)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS categoria (id_categoria INT NOT NULL AUTO_INCREMENT, id_produto INT DEFAULT NULL, descricao VARCHAR(255), nome VARCHAR(100), PRIMARY KEY(id_categoria)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS fornecedor (id_fornecedor INT NOT NULL AUTO_INCREMENT, id_produto INT DEFAULT NULL, telefone VARCHAR(20), cnpj VARCHAR(18), nome VARCHAR(100), email VARCHAR(150), PRIMARY KEY(id_fornecedor)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS produto (id_produto INT NOT NULL AUTO_INCREMENT, id_estoque INT DEFAULT NULL, id_movimentacoes INT DEFAULT NULL, nome VARCHAR(100), preco DECIMAL(10,2), quantidade INT DEFAULT 0, estoque_minimo INT NOT NULL DEFAULT 10, observacao_local VARCHAR(255) DEFAULT NULL, status ENUM('ativo','inativo') DEFAULT 'ativo', id_categoria INT DEFAULT NULL, id_fornecedor INT DEFAULT NULL, PRIMARY KEY(id_produto)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS movimentacoes (id_movi INT NOT NULL AUTO_INCREMENT, id_usuario INT DEFAULT NULL, id_produto INT DEFAULT NULL, quantidade INT DEFAULT NULL, tipo ENUM('entrada','saida') DEFAULT NULL, data DATETIME DEFAULT NULL, observacao VARCHAR(255), PRIMARY KEY(id_movi)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS qr_code (id_qrcode INT NOT NULL AUTO_INCREMENT, id_produto INT DEFAULT NULL, codigo VARCHAR(255), PRIMARY KEY(id_qrcode)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $pdo->exec("CREATE TABLE IF NOT EXISTS rel (id_usuario INT NOT NULL, id_produto INT NOT NULL, PRIMARY KEY(id_usuario,id_produto)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

    // Compatibilidade com bancos já criados: adiciona os campos novos sem apagar os produtos existentes.
    $colsProduto = $pdo->query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '$db' AND TABLE_NAME = 'produto'")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('estoque_minimo', $colsProduto, true)) {
        $pdo->exec("ALTER TABLE produto ADD COLUMN estoque_minimo INT NOT NULL DEFAULT 10 AFTER quantidade");
    }
    if (!in_array('observacao_local', $colsProduto, true)) {
        $pdo->exec("ALTER TABLE produto ADD COLUMN observacao_local VARCHAR(255) DEFAULT NULL AFTER estoque_minimo");
    }

    // Corrige bancos que já existiam antes desta versão e ainda tinham IDs sem AUTO_INCREMENT.
    // Sem isso, o segundo cadastro pode tentar reutilizar o ID 0.
    $autoIds = [
        'alertas' => 'id_alerta',
        'estoque' => 'id_estoque',
        'categoria' => 'id_categoria',
        'fornecedor' => 'id_fornecedor',
        'movimentacoes' => 'id_movi',
        'produto' => 'id_produto',
        'qr_code' => 'id_qrcode',
        'usuario' => 'id_usuario'
    ];
    foreach ($autoIds as $table => $column) {
        $pdo->exec("ALTER TABLE `$table` MODIFY `$column` INT NOT NULL AUTO_INCREMENT");
    }

    // Define o próximo ID com base no maior registro já existente.
    foreach ($autoIds as $table => $column) {
        $next = (int)$pdo->query("SELECT COALESCE(MAX(`$column`), 0) + 1 FROM `$table`")->fetchColumn();
        $pdo->exec("ALTER TABLE `$table` AUTO_INCREMENT = $next");
    }
} catch (Throwable $e) {
    out(['ok'=>false,'message'=>'Não foi possível conectar ao MariaDB. Confira se o MySQL/MariaDB do XAMPP está ligado.'],500);
}

/* O SQL fornecido não contém dados iniciais. O administrador é criado
   automaticamente na primeira chamada, caso ainda não exista. */
try {
    $stmt=$pdo->prepare("SELECT id_usuario FROM usuario WHERE email=? LIMIT 1");
    $stmt->execute(['admin@skalad.com']);
    if (!$stmt->fetch()) {
        $hash=password_hash('1234', PASSWORD_DEFAULT);
        // O SQL original não garantia AUTO_INCREMENT em id_usuario, então usamos um ID explícito.
        $next=(int)$pdo->query("SELECT COALESCE(MAX(id_usuario),0)+1 FROM usuario")->fetchColumn();
        $pdo->prepare("INSERT INTO usuario (id_usuario,nome,email,status,senha,perfil) VALUES (?,?,?,?,?,?)")
            ->execute([$next,'Administrador','admin@skalad.com','ativo',$hash,'admin']);
    }
} catch (Throwable $e) {
    out(['ok'=>false,'message'=>'Banco encontrado, mas as tabelas ainda não foram importadas. Importe o arquivo skalad.sql no phpMyAdmin.'],500);
}

$action=$_GET['action'] ?? '';
$method=$_SERVER['REQUEST_METHOD'];

function logged() {
    if (empty($_SESSION['usuario'])) out(['ok'=>false,'message'=>'Sessão expirada. Faça login novamente.'],401);
    return $_SESSION['usuario'];
}
function body() {
    $raw=file_get_contents('php://input');
    $data=json_decode($raw,true);
    return is_array($data)?$data:[];
}

try {
    if ($action==='login' && $method==='POST') {
        $d=body();
        $email=trim($d['email']??'');
        $senha=(string)($d['senha']??'');
        $s=$pdo->prepare("SELECT id_usuario,nome,email,status,senha,perfil FROM usuario WHERE email=? LIMIT 1");
        $s->execute([$email]);
        $u=$s->fetch();
        if (!$u || $u['status']!=='ativo' || !password_verify($senha,$u['senha'])) {
            out(['ok'=>false,'message'=>'E-mail ou senha incorretos.'],401);
        }
        unset($u['senha']);
        $_SESSION['usuario']=$u;
        out(['ok'=>true,'usuario'=>$u]);
    }

    if ($action==='logout') {
        session_destroy();
        out(['ok'=>true]);
    }

    if ($action==='me') {
        out(['ok'=>true,'usuario'=>logged()]);
    }

    $u=logged();

    if ($action==='dashboard') {
        $prod=(int)$pdo->query("SELECT COUNT(*) FROM produto")->fetchColumn();
        $qtd=(int)$pdo->query("SELECT COALESCE(SUM(quantidade),0) FROM produto")->fetchColumn();
        $baixo=(int)$pdo->query("SELECT COUNT(*) FROM produto p LEFT JOIN estoque e ON e.id_estoque=p.id_estoque LEFT JOIN categoria c ON c.id_categoria=p.id_categoria WHERE p.quantidade <= COALESCE(p.estoque_minimo,10)")->fetchColumn();
        $crit=(int)$pdo->query("SELECT COUNT(*) FROM produto WHERE quantidade <= 0")->fetchColumn();
        $mov=$pdo->query("SELECT m.*,p.nome produto FROM movimentacoes m LEFT JOIN produto p ON p.id_produto=m.id_produto ORDER BY m.data DESC,m.id_movi DESC LIMIT 8")->fetchAll();
        $grafico=$pdo->query("SELECT DATE(data) dia, tipo, SUM(quantidade) quantidade FROM movimentacoes WHERE data >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) GROUP BY DATE(data), tipo ORDER BY dia")->fetchAll();
        $alertas=$pdo->query("SELECT p.id_produto,p.nome,p.quantidade,COALESCE(p.estoque_minimo,10) estoque_minimo,COALESCE(e.localizacao,'') localizacao FROM produto p LEFT JOIN estoque e ON e.id_estoque=p.id_estoque WHERE p.quantidade <= COALESCE(p.estoque_minimo,10) OR e.localizacao IS NULL OR TRIM(e.localizacao)='' ORDER BY CASE WHEN p.quantidade<=0 THEN 0 WHEN p.quantidade<=COALESCE(p.estoque_minimo,10) THEN 1 ELSE 2 END, p.nome LIMIT 10")->fetchAll();
        $semLocal=(int)$pdo->query("SELECT COUNT(*) FROM produto p LEFT JOIN estoque e ON e.id_estoque=p.id_estoque WHERE e.localizacao IS NULL OR TRIM(e.localizacao)=''")->fetchColumn();
        out(['ok'=>true,'produtos'=>$prod,'quantidade'=>$qtd,'baixo'=>$baixo,'criticos'=>$crit,'sem_localizacao'=>$semLocal,'movimentacoes'=>$mov,'grafico'=>$grafico,'alertas'=>$alertas]);
    }

    // QR Codes são vinculados ao produto e armazenados no banco de dados.
    if ($action==='qrcode' && $method==='POST') {
        $d=body();
        $pid=(int)($d['id_produto']??0);
        $codigo=trim((string)($d['codigo']??''));
        if ($pid<1 || $codigo==='') out(['ok'=>false,'message'=>'Produto e código são obrigatórios.'],422);

        $s=$pdo->prepare("SELECT id_produto FROM produto WHERE id_produto=?");
        $s->execute([$pid]);
        if (!$s->fetch()) out(['ok'=>false,'message'=>'Produto não encontrado.'],404);

        $s=$pdo->prepare("SELECT id_qrcode FROM qr_code WHERE id_produto=? LIMIT 1");
        $s->execute([$pid]);
        $existente=$s->fetch();
        if ($existente) {
            $pdo->prepare("UPDATE qr_code SET codigo=? WHERE id_qrcode=?")->execute([$codigo,$existente['id_qrcode']]);
        } else {
            $pdo->prepare("INSERT INTO qr_code (id_produto,codigo) VALUES (?,?)")->execute([$pid,$codigo]);
        }
        out(['ok'=>true,'message'=>'Código salvo no banco de dados.']);
    }

    if ($action==='qrcode' && $method==='GET') {
        $pid=(int)($_GET['id_produto']??0);
        $s=$pdo->prepare("SELECT q.id_qrcode,q.id_produto,q.codigo,p.nome FROM qr_code q INNER JOIN produto p ON p.id_produto=q.id_produto WHERE q.id_produto=? LIMIT 1");
        $s->execute([$pid]);
        out(['ok'=>true,'qrcode'=>$s->fetch() ?: null]);
    }

    if ($action==='produtos') {
        $sql="SELECT p.id_produto,p.nome,p.preco,p.quantidade,p.status,
                     COALESCE(c.nome,'Sem categoria') categoria,
                     COALESCE(e.localizacao,'Sem localização') localizacao,
                     COALESCE(p.estoque_minimo,10) estoque_minimo,
                     COALESCE(p.observacao_local,'') observacao_local
              FROM produto p
              LEFT JOIN categoria c ON c.id_categoria=p.id_categoria
              LEFT JOIN estoque e ON e.id_estoque=p.id_estoque
              ORDER BY p.nome";
        out(['ok'=>true,'produtos'=>$pdo->query($sql)->fetchAll()]);
    }

    if ($action==='produto' && $method==='POST') {
        $d=body();
        $nome=trim($d['nome']??'');
        if ($nome==='') out(['ok'=>false,'message'=>'Informe o nome do produto.'],422);
        $pdo->beginTransaction();
        $pdo->prepare("INSERT INTO produto (nome,preco,quantidade,estoque_minimo,observacao_local,status) VALUES (?,?,?,?,?,?)")
            ->execute([$nome,(float)($d['preco']??0),(int)($d['quantidade']??0),max(0,(int)($d['estoque_minimo']??10)),trim($d['observacao_local']??''),'ativo']);
        $id=(int)$pdo->lastInsertId();
        $pdo->prepare("INSERT INTO estoque (localizacao,status) VALUES (?,?)")
            ->execute([trim($d['localizacao']??''),'ativo']);
        $estoque=(int)$pdo->lastInsertId();
        $pdo->prepare("INSERT INTO categoria (id_produto,nome,descricao) VALUES (?,?,?)")
            ->execute([$id,trim($d['categoria']??'Sem categoria'),trim($d['categoria']??'')]);
        $cat=(int)$pdo->lastInsertId();
        $pdo->prepare("UPDATE produto SET id_estoque=?,id_categoria=? WHERE id_produto=?")->execute([$estoque,$cat,$id]);
        $pdo->commit();
        out(['ok'=>true,'message'=>'Produto salvo.']);
    }

    if ($action==='produto' && $method==='PUT') {
        $d=body(); $id=(int)($d['id']??0);
        $pdo->beginTransaction();
        $s=$pdo->prepare("SELECT id_estoque,id_categoria FROM produto WHERE id_produto=?");
        $s->execute([$id]); $p=$s->fetch();
        if (!$p) { $pdo->rollBack(); out(['ok'=>false,'message'=>'Produto não encontrado.'],404); }
        $pdo->prepare("UPDATE produto SET nome=?,preco=?,quantidade=?,estoque_minimo=?,observacao_local=? WHERE id_produto=?")
            ->execute([trim($d['nome']??''),(float)($d['preco']??0),(int)($d['quantidade']??0),max(0,(int)($d['estoque_minimo']??10)),trim($d['observacao_local']??''),$id]);
        if ($p['id_estoque']) $pdo->prepare("UPDATE estoque SET localizacao=? WHERE id_estoque=?")->execute([trim($d['localizacao']??''),$p['id_estoque']]);
        if ($p['id_categoria']) $pdo->prepare("UPDATE categoria SET nome=?,descricao=? WHERE id_categoria=?")->execute([trim($d['categoria']??'Sem categoria'),trim($d['categoria']??''),$p['id_categoria']]);
        $pdo->commit(); out(['ok'=>true,'message'=>'Produto atualizado.']);
    }

    if ($action==='produto' && $method==='DELETE') {
        $d=body(); $id=(int)($d['id']??0);
        $pdo->beginTransaction();
        $s=$pdo->prepare("SELECT id_estoque,id_categoria FROM produto WHERE id_produto=?"); $s->execute([$id]); $p=$s->fetch();
        if (!$p) { $pdo->rollBack(); out(['ok'=>false,'message'=>'Produto não encontrado.'],404); }
        $pdo->prepare("DELETE FROM qr_code WHERE id_produto=?")->execute([$id]);
        $pdo->prepare("DELETE FROM rel WHERE id_produto=?")->execute([$id]);
        $pdo->prepare("DELETE FROM movimentacoes WHERE id_produto=?")->execute([$id]);
        $pdo->prepare("UPDATE categoria SET id_produto=NULL WHERE id_categoria=?")->execute([$p['id_categoria']]);
        $pdo->prepare("UPDATE produto SET id_categoria=NULL,id_estoque=NULL WHERE id_produto=?")->execute([$id]);
        if ($p['id_categoria']) $pdo->prepare("DELETE FROM categoria WHERE id_categoria=?")->execute([$p['id_categoria']]);
        if ($p['id_estoque']) $pdo->prepare("DELETE FROM estoque WHERE id_estoque=?")->execute([$p['id_estoque']]);
        $pdo->prepare("DELETE FROM produto WHERE id_produto=?")->execute([$id]);
        $pdo->commit(); out(['ok'=>true,'message'=>'Produto excluído.']);
    }

    if ($action==='movimentacoes') {
        $rows=$pdo->query("SELECT m.*,p.nome produto FROM movimentacoes m LEFT JOIN produto p ON p.id_produto=m.id_produto ORDER BY m.data DESC,m.id_movi DESC")->fetchAll();
        out(['ok'=>true,'movimentacoes'=>$rows]);
    }

    if ($action==='movimentacao' && $method==='POST') {
        $d=body(); $pid=(int)($d['produto']??0); $tipo=$d['tipo']??''; $q=(int)($d['quantidade']??0);
        if (!in_array($tipo,['entrada','saida'],true) || $q<1) out(['ok'=>false,'message'=>'Dados de movimentação inválidos.'],422);
        $pdo->beginTransaction();
        $s=$pdo->prepare("SELECT quantidade FROM produto WHERE id_produto=? FOR UPDATE"); $s->execute([$pid]); $p=$s->fetch();
        if (!$p) { $pdo->rollBack(); out(['ok'=>false,'message'=>'Produto não encontrado.'],404); }
        $nova=(int)$p['quantidade'] + ($tipo==='entrada'?$q:-$q);
        if ($nova<0) { $pdo->rollBack(); out(['ok'=>false,'message'=>'Não há quantidade suficiente em estoque.'],422); }
        $pdo->prepare("UPDATE produto SET quantidade=? WHERE id_produto=?")->execute([$nova,$pid]);
        $pdo->prepare("INSERT INTO movimentacoes (id_usuario,id_produto,quantidade,tipo,data,observacao) VALUES (?,?,?,?,NOW(),?)")
            ->execute([$u['id_usuario'],$pid,$q,$tipo,trim($d['observacao']??'')]);
        $pdo->commit(); out(['ok'=>true,'message'=>'Movimentação registrada.']);
    }

    if ($action==='usuarios') {
        if ($u['perfil']!=='admin') out(['ok'=>false,'message'=>'Apenas administradores podem acessar os usuários.'],403);
        $rows=$pdo->query("SELECT id_usuario,nome,email,perfil,status FROM usuario ORDER BY nome")->fetchAll();
        out(['ok'=>true,'usuarios'=>$rows]);
    }

    if ($action==='usuario' && $method==='POST') {
        if ($u['perfil']!=='admin') out(['ok'=>false,'message'=>'Apenas administradores podem cadastrar usuários.'],403);
        $d=body(); $nome=trim($d['nome']??''); $email=trim($d['email']??''); $senha=(string)($d['senha']??'');
        $perfil=($d['perfil']??'Operador')==='Administrador'?'admin':'usuario';
        $status=($d['ativo']??true)?'ativo':'inativo';
        if ($nome==='' || !filter_var($email,FILTER_VALIDATE_EMAIL) || strlen($senha)<4) out(['ok'=>false,'message'=>'Informe nome, e-mail válido e senha com pelo menos 4 caracteres.'],422);
        $pdo->prepare("INSERT INTO usuario (nome,email,status,senha,perfil) VALUES (?,?,?,?,?)")
            ->execute([$nome,$email,$status,password_hash($senha,PASSWORD_DEFAULT),$perfil]);
        out(['ok'=>true,'message'=>'Usuário cadastrado.']);
    }

    if ($action==='usuario' && $method==='PUT') {
        if ($u['perfil']!=='admin') out(['ok'=>false,'message'=>'Apenas administradores podem editar usuários.'],403);
        $d=body(); $id=(int)($d['id']??0); $nome=trim($d['nome']??''); $email=trim($d['email']??'');
        $perfil=($d['perfil']??'Operador')==='Administrador'?'admin':'usuario'; $status=($d['ativo']??true)?'ativo':'inativo'; $senha=(string)($d['senha']??'');
        if ($id<1 || $nome==='' || !filter_var($email,FILTER_VALIDATE_EMAIL)) out(['ok'=>false,'message'=>'Confira o nome e o e-mail do usuário.'],422);
        if ($id===(int)$u['id_usuario'] && $status!=='ativo') out(['ok'=>false,'message'=>'Você não pode desativar o próprio usuário durante a sessão.'],422);
        if ($senha!=='' && strlen($senha)<4) out(['ok'=>false,'message'=>'A nova senha precisa ter pelo menos 4 caracteres.'],422);
        if ($senha!=='') $pdo->prepare("UPDATE usuario SET nome=?,email=?,perfil=?,status=?,senha=? WHERE id_usuario=?")->execute([$nome,$email,$perfil,$status,password_hash($senha,PASSWORD_DEFAULT),$id]);
        else $pdo->prepare("UPDATE usuario SET nome=?,email=?,perfil=?,status=? WHERE id_usuario=?")->execute([$nome,$email,$perfil,$status,$id]);
        if ($id===(int)$u['id_usuario']) { $_SESSION['usuario']['nome']=$nome; $_SESSION['usuario']['email']=$email; $_SESSION['usuario']['perfil']=$perfil; }
        out(['ok'=>true,'message'=>'Usuário atualizado.']);
    }

    if ($action==='usuario' && $method==='DELETE') {
        if ($u['perfil']!=='admin') out(['ok'=>false,'message'=>'Apenas administradores podem excluir usuários.'],403);
        $d=body(); $id=(int)($d['id']??0);
        if ($id<1) out(['ok'=>false,'message'=>'Usuário inválido.'],422);
        if ($id===(int)$u['id_usuario']) out(['ok'=>false,'message'=>'Você não pode excluir o usuário conectado.'],422);
        $pdo->prepare("DELETE FROM rel WHERE id_usuario=?")->execute([$id]);
        $pdo->prepare("UPDATE movimentacoes SET id_usuario=NULL WHERE id_usuario=?")->execute([$id]);
        $s=$pdo->prepare("DELETE FROM usuario WHERE id_usuario=?"); $s->execute([$id]);
        if (!$s->rowCount()) out(['ok'=>false,'message'=>'Usuário não encontrado.'],404);
        out(['ok'=>true,'message'=>'Usuário excluído.']);
    }

    out(['ok'=>false,'message'=>'Ação não encontrada.'],404);
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    out(['ok'=>false,'message'=>'Erro no servidor: '.$e->getMessage()],500);
}
?>
