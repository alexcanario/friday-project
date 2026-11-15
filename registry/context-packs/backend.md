# Pacote de contexto: backend

## Regras
- Escreva primeiro o teste xUnit de cada critério e confirme que ele falha pelo motivo certo.
- Mantenha as camadas do projeto: a regra de negócio fica em serviços e classes de domínio, o acesso a dados fica atrás de uma interface.
- Não adicione dependência que a issue não nomeia e não altere arquivos fora do escopo da issue.
- Rode exatamente `dotnet test`, sem argumentos extras.

## Padrões
- Um serviço por responsabilidade, com as dependências recebidas pelo construtor.
- Nomes de teste no formato `Metodo_Condicao_Resultado`, um comportamento por teste.
- Entradas inválidas viram exceção tipada ou resultado explícito, nunca valor silencioso.

## Ferramentas
- `dotnet restore`, `dotnet build` e `dotnet test` para compilar e testar.
- `git status` e `git diff` para revisar a própria mudança; o envio é feito por `git_push`.
- Teste de unidade com xUnit e asserções simples; dublês escritos à mão quando bastam.

## Modelo
Exemplo de serviço com o teste que o cobre:

```csharp
public interface IOrderRepository
{
    Order? Find(int id);
}

public sealed class OrderService(IOrderRepository repository)
{
    public decimal Total(int orderId)
    {
        var order = repository.Find(orderId)
            ?? throw new KeyNotFoundException($"Order {orderId} not found");
        return order.Lines.Sum(l => l.Price * l.Quantity);
    }
}

public class OrderServiceTests
{
    [Fact]
    public void Total_UnknownOrder_Throws()
    {
        var service = new OrderService(new EmptyRepository());
        Assert.Throws<KeyNotFoundException>(() => service.Total(1));
    }
}
```
