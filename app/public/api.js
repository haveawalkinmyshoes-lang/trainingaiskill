// These failures are returned before a request reaches the trainer or AI.
const staleErrors=new Set(['Откройте приложение перед отправкой запроса','Обновите страницу: истек токен запроса']);
export function createApi({getCsrf,setCsrf,onExpired,fetchImpl=fetch}){
  async function api(path,data,retried=false){
    const response=await fetchImpl('/api/'+path,{method:data===undefined?'GET':'POST',credentials:'same-origin',
      headers:data===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':getCsrf()},body:data===undefined?undefined:JSON.stringify(data)});
    let value;try{value=await response.json();}catch{throw new Error('Сервер временно недоступен. Попробуйте ещё раз.');}
    const auth=path.startsWith('auth/');
    if(response.status===403&&staleErrors.has(value.error)){
      if(retried)throw new Error('Не удалось восстановить доступ. Обновите страницу и убедитесь, что браузер разрешает cookie для приложения.');
      const fresh=await api('auth/status');setCsrf(fresh.csrf);
      if(!auth){
        if(fresh.required&&!fresh.employee){
          const message='Сессия завершена. Войдите снова, чтобы начать новую тренировку.';
          onExpired({login:true,message});throw new Error(message);
        }
        // A restart or a login in another tab may have removed this conversation.
        const session=path.match(/^sessions\/([a-f0-9-]+)(?:\/|$)/);
        if(session)await api('sessions/'+session[1]);
      }
      return api(path,data,true);
    }
    if(!response.ok){
      if(!auth&&response.status===401){
        const message='Сессия завершена. Войдите снова.';
        onExpired({login:true,message});throw new Error(message);
      }
      if(response.status===404&&/^sessions\//.test(path)){
        const message='Разговор больше недоступен: сервер был перезапущен или вход изменился. Начните новую тренировку.';
        onExpired({login:false,message});throw new Error(message);
      }
      throw new Error(value.error||'Не удалось выполнить запрос');
    }
    return value;
  }
  return api;
}
