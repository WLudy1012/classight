using System.Linq.Expressions;
using Classight.SharedKernel;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace Classight.Platform;

public static class QuerySort
{
    public static IQueryable<T> Apply<T>(IQueryable<T> query, HttpRequest request, string defaultSort, IReadOnlyDictionary<string, string> allowed)
    {
        var sort = request.Query["sort"].FirstOrDefault() ?? defaultSort;
        var fields = sort.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (fields.Length is 0 or > 4) throw ApiException.Validation("sort", "排序字段数量须为 1–4");
        var first = true;
        foreach (var field in fields)
        {
            var descending = field.StartsWith('-'); var key = descending ? field[1..] : field;
            if (!allowed.TryGetValue(key, out var property)) throw ApiException.Validation("sort", "不支持的排序字段: " + key);
            var parameter = Expression.Parameter(typeof(T), "x"); var member = Expression.Property(parameter, property);
            var method = first ? descending ? "OrderByDescending" : "OrderBy" : descending ? "ThenByDescending" : "ThenBy";
            query = query.Provider.CreateQuery<T>(Expression.Call(typeof(Queryable), method, [typeof(T), member.Type], query.Expression, Expression.Quote(Expression.Lambda(member, parameter)))); first = false;
        }
        if (typeof(Entity).IsAssignableFrom(typeof(T)))
        {
            var parameter = Expression.Parameter(typeof(T), "x"); var member = Expression.Property(parameter, "Id");
            query = query.Provider.CreateQuery<T>(Expression.Call(typeof(Queryable), "ThenBy", [typeof(T), typeof(Guid)], query.Expression, Expression.Quote(Expression.Lambda(member, parameter))));
        }
        return query;
    }
    public static async Task<Page<T>> Page<T>(IQueryable<T> query, HttpRequest request, CancellationToken ct) where T : Entity
    {
        var (page, size) = Input.Paging(request); var total = await query.CountAsync(ct);
        var allowed = new Dictionary<string, string> { ["createdAt"] = "CreatedAt" };
        if (typeof(T).GetProperty("Name") is not null) allowed["name"] = "Name";
        return new(await Apply(query, request, "-createdAt", allowed).Skip((page - 1) * size).Take(size).ToListAsync(ct), total, page, size);
    }
}
