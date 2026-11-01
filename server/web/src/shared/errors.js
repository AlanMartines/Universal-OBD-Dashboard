export const MESSAGES = {
  invalid_credentials: 'Usuário ou senha incorretos.',
  invalid_request: 'Confira os dados informados.',
  too_many_requests: 'Muitas tentativas. Aguarde um pouco e tente de novo.',
  signup_closed: 'O cadastro está fechado. Peça uma conta ao administrador.',
  username_invalid: 'O usuário deve ter de 3 a 32 caracteres: letras minúsculas, números, ponto, _ ou -.',
  username_taken: 'Esse nome de usuário não está disponível.',
  password_too_short: 'A senha precisa ter pelo menos 15 caracteres. Uma frase longa é uma boa opção.',
  password_too_long: 'A senha passa de 256 caracteres.',
  password_common: 'Essa senha é fácil demais de adivinhar.',
  password_contains_username: 'A senha não pode conter o nome do usuário.',
  password_unchanged: 'A nova senha precisa ser diferente da atual.',
  password_mismatch: 'As duas senhas não conferem.',
  current_password_wrong: 'A senha atual está incorreta.',
  device_limit: 'Você atingiu o limite de dispositivos. Revogue um que não usa mais.',
  admin_cannot_self_delete: 'Esta conta não pode ser excluída por aqui. Fale com o administrador.',
  account_required: 'Escolha a conta à qual o usuário será vinculado.',
  account_invalid: 'A conta escolhida não é válida.',
  cannot_change_self: 'Você não pode fazer essa alteração na sua própria conta.',
  email_invalid: 'Informe um e-mail válido.',
  email_mismatch: 'Os dois e-mails não conferem.',
  email_unchanged: 'Este já é o seu e-mail.',
  email_link_invalid: 'Este link é inválido ou já venceu. Peça a troca de novo em Meus Dados.',
  mail_unavailable: 'O envio de e-mails está indisponível no momento. Tente mais tarde.',
  image_invalid: 'Não foi possível usar esta imagem. Envie um arquivo JPG, PNG ou WebP.',
  image_too_large: 'A foto passa de 5 MB. Escolha um arquivo menor.',
  mfa_code_invalid: 'Código incorreto. Confira o aplicativo e tente de novo.',
  mfa_expired: 'A verificação expirou. Entre novamente.',
  mfa_already_enabled: 'A verificação em duas etapas já está ativa.',
  reset_link_invalid: 'Este link é inválido ou já venceu. Peça um novo em "Esqueci minha senha".',
  not_found: 'Não encontrado.',
  forbidden: 'Você não tem acesso a esta página.',
  bad_form: 'O formulário expirou. Recarregue a página e tente de novo.',
  internal_error: 'Algo deu errado. Tente novamente.',
};

// Avisos de sucesso depois de um redirecionamento. Lista fechada: o texto nunca vem da URL.
export const NOTICES = {
  device_revoked: 'Dispositivo revogado.',
  device_deleted: 'Dispositivo e dados excluídos.',
  user_updated: 'Usuário atualizado.',
  user_deleted: 'Usuário excluído.',
  signup_updated: 'Cadastro público atualizado.',
  profile_saved: 'Dados atualizados.',
  password_saved: 'Senha alterada.',
  photo_saved: 'Foto atualizada.',
  photo_removed: 'Foto removida.',
  mfa_disabled: 'Verificação em duas etapas desativada.',
  session_revoked: 'Sessão encerrada.',
  sessions_revoked: 'As outras sessões foram encerradas.',
  password_reset: 'Senha alterada. Entre com a nova senha.',
  email_sent: 'Se o endereço puder ser usado, enviamos um link de confirmação para ele.',
};

export const message = (code) => MESSAGES[code] ?? MESSAGES.internal_error;

export class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
