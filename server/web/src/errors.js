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
  admin_cannot_self_delete: 'A conta de administrador não pode se excluir por aqui.',
  cannot_change_self: 'Você não pode fazer essa alteração na sua própria conta.',
  not_found: 'Não encontrado.',
  forbidden: 'Você não tem acesso a esta página.',
  bad_form: 'O formulário expirou. Recarregue a página e tente de novo.',
  internal_error: 'Algo deu errado. Tente novamente.',
};

export const message = (code) => MESSAGES[code] ?? MESSAGES.internal_error;

export class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
